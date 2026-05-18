import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";

export class ExchangeApiError extends Error {
  constructor(message: string, public retCode?: number) {
    super(message);
    this.name = "ExchangeApiError";
  }
}

export class ExchangeClientError extends Error {
  constructor(message: string, public retCode?: number) {
    super(message);
    this.name = "ExchangeClientError";
  }
}

interface BybitResponse<T = unknown> {
  retCode: number;
  retMsg: string;
  result: T;
}

const RETRYABLE_CODES = new Set<number>([
  10006, // request timeout
  10016, // service error / internal
  10018, // exceeded ip rate limit
  10429, // too many requests
  170131, // insufficient balance (sometimes transient on Unified)
]);

function classifyRetCode(retCode: number, retMsg: string): Error | null {
  if (retCode === 0) return null;
  if (retCode === 110043) return null; // "leverage not modified" — benign
  if (retCode === 110026) return null; // "margin mode not modified" — benign
  if (RETRYABLE_CODES.has(retCode))
    return new ExchangeApiError(`Bybit ${retCode}: ${retMsg}`, retCode);
  return new ExchangeClientError(`Bybit ${retCode}: ${retMsg}`, retCode);
}

function signRequest(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryOrBody: string
): string {
  return crypto
    .createHmac("sha256", config.BYBIT_API_SECRET)
    .update(timestamp + apiKey + recvWindow + queryOrBody)
    .digest("hex");
}

const baseURL = config.BYBIT_TESTNET
  ? "https://api-testnet.bybit.com"
  : "https://api.bybit.com";

const client: AxiosInstance = axios.create({ baseURL, timeout: 10_000 });

client.interceptors.request.use((req: InternalAxiosRequestConfig) => {
  if (!config.BYBIT_API_KEY) return req; // unsigned passthrough; caller will error
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  let payload = "";
  if ((req.method ?? "").toLowerCase() === "get") {
    const params = new URLSearchParams(req.params as Record<string, string>);
    payload = params.toString();
  } else {
    payload = typeof req.data === "string" ? req.data : JSON.stringify(req.data ?? {});
  }
  const sign = signRequest(timestamp, config.BYBIT_API_KEY, recvWindow, payload);
  req.headers.set("X-BAPI-API-KEY", config.BYBIT_API_KEY);
  req.headers.set("X-BAPI-SIGN", sign);
  req.headers.set("X-BAPI-SIGN-TYPE", "2");
  req.headers.set("X-BAPI-TIMESTAMP", timestamp);
  req.headers.set("X-BAPI-RECV-WINDOW", recvWindow);
  if ((req.method ?? "").toLowerCase() !== "get") {
    req.headers.set("Content-Type", "application/json");
  }
  return req;
});

async function call<T>(
  method: "get" | "post",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!config.BYBIT_API_KEY || !config.BYBIT_API_SECRET) {
    throw new ExchangeClientError(
      "Bybit API key/secret not configured (BYBIT_API_KEY / BYBIT_API_SECRET)"
    );
  }
  try {
    const resp =
      method === "get"
        ? await client.get<BybitResponse<T>>(path, { params: body ?? {} })
        : await client.post<BybitResponse<T>>(path, body ?? {});
    const err = classifyRetCode(resp.data.retCode, resp.data.retMsg);
    if (err) throw err;
    return resp.data.result;
  } catch (e) {
    if (e instanceof ExchangeApiError || e instanceof ExchangeClientError) throw e;
    if (axios.isAxiosError(e)) {
      const status = e.response?.status ?? 0;
      const msg = e.message;
      if (status >= 500 || status === 429 || e.code === "ECONNABORTED") {
        throw new ExchangeApiError(`Bybit HTTP ${status}: ${msg}`, status);
      }
      throw new ExchangeClientError(`Bybit HTTP ${status}: ${msg}`, status);
    }
    throw new ExchangeClientError(
      `Bybit unknown: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// ---- Typed surface ----

export interface WalletCoin {
  coin: string;
  walletBalance: string;
  availableToWithdraw: string;
}
interface WalletBalanceResult {
  list: Array<{ coin: WalletCoin[] }>;
}

/** USDT balance available in the Unified Trading Account. Falls back to 0 if Bybit omits the coin (fresh empty account). */
export async function getWalletBalanceUsdt(): Promise<number> {
  const r = await call<WalletBalanceResult>("get", "/v5/account/wallet-balance", {
    accountType: "UNIFIED",
  });
  const coins = r.list?.[0]?.coin ?? [];
  const usdt = coins.find((c) => c.coin === "USDT");
  if (!usdt) return 0;
  const n = Number(usdt.walletBalance);
  return Number.isFinite(n) ? n : 0;
}

// retCode 110043 (leverage not modified) is treated as success in classifyRetCode,
// so call() returns without throwing on that benign case — no try/catch needed.
export async function setLeverage(symbol: string, leverage: number): Promise<void> {
  await call<unknown>("post", "/v5/position/set-leverage", {
    category: "linear",
    symbol,
    buyLeverage: String(leverage),
    sellLeverage: String(leverage),
  });
}

// retCode 110026 (margin mode not modified) is the equivalent benign case.
export async function setMarginModeIsolated(
  symbol: string,
  leverage: number
): Promise<void> {
  await call<unknown>("post", "/v5/position/switch-isolated", {
    category: "linear",
    symbol,
    tradeMode: 1,
    buyLeverage: String(leverage),
    sellLeverage: String(leverage),
  });
}

interface TickerListResult {
  list: Array<{ symbol: string; lastPrice: string; bid1Price: string; ask1Price: string }>;
}

export async function getLastPrice(symbol: string): Promise<number> {
  const r = await call<TickerListResult>("get", "/v5/market/tickers", {
    category: "linear",
    symbol,
  });
  const p = Number(r.list?.[0]?.lastPrice);
  if (!Number.isFinite(p)) throw new ExchangeApiError(`No ticker for ${symbol}`);
  return p;
}

interface InstrumentInfo {
  symbol: string;
  lotSizeFilter: { qtyStep: string; minOrderQty: string; maxOrderQty: string };
  priceFilter: { tickSize: string };
}

interface InstrumentListResult {
  list: InstrumentInfo[];
}

export async function getInstrumentInfo(symbol: string): Promise<InstrumentInfo> {
  const r = await call<InstrumentListResult>("get", "/v5/market/instruments-info", {
    category: "linear",
    symbol,
  });
  const inst = r.list?.[0];
  if (!inst) throw new ExchangeApiError(`No instrument info for ${symbol}`);
  return inst;
}

export interface CreateOrderArgs {
  symbol: string;
  side: "Buy" | "Sell";
  orderType: "Market" | "Limit";
  qty: string;
  price?: string;
  takeProfit?: string;
  stopLoss?: string;
  orderLinkId: string;
}

interface CreateOrderResult {
  orderId: string;
  orderLinkId: string;
}

export async function createOrder(args: CreateOrderArgs): Promise<CreateOrderResult> {
  return await call<CreateOrderResult>("post", "/v5/order/create", {
    category: "linear",
    symbol: args.symbol,
    side: args.side,
    orderType: args.orderType,
    qty: args.qty,
    ...(args.price ? { price: args.price } : {}),
    ...(args.takeProfit ? { takeProfit: args.takeProfit } : {}),
    ...(args.stopLoss ? { stopLoss: args.stopLoss } : {}),
    tpslMode: "Full",
    orderLinkId: args.orderLinkId,
    positionIdx: 0,
  });
}

export interface BybitOrder {
  orderId: string;
  orderLinkId: string;
  orderStatus: string;
  side: "Buy" | "Sell";
  price: string;
  avgPrice: string;
  qty: string;
  cumExecQty: string;
  cumExecValue: string;
  cumExecFee: string;
}

interface OrderListResult { list: BybitOrder[] }

export async function getOrderByLinkId(orderLinkId: string): Promise<BybitOrder | null> {
  const r = await call<OrderListResult>("get", "/v5/order/realtime", {
    category: "linear",
    orderLinkId,
  });
  if (r.list && r.list.length > 0) return r.list[0];
  // Try history endpoint for closed orders
  const hist = await call<OrderListResult>("get", "/v5/order/history", {
    category: "linear",
    orderLinkId,
  });
  return hist.list?.[0] ?? null;
}

export interface BybitPosition {
  symbol: string;
  side: string;
  size: string;
  avgPrice: string;
  unrealisedPnl: string;
  curRealisedPnl: string;
}

interface PositionListResult { list: BybitPosition[] }

export async function getPosition(symbol: string): Promise<BybitPosition | null> {
  const r = await call<PositionListResult>("get", "/v5/position/list", {
    category: "linear",
    symbol,
  });
  const p = r.list?.[0];
  if (!p) return null;
  if (Number(p.size) === 0) return null; // closed
  return p;
}

export interface BybitExecution {
  symbol: string;
  side: "Buy" | "Sell";
  execPrice: string;
  execQty: string;
  execFee: string;
  feeCurrency: string | null;
  closedSize: string;
  execType: string;
  execTime: string;
  closedPnl: string;
}

interface ExecListResult { list: BybitExecution[] }

export async function getRecentExecutions(
  symbol: string,
  limit = 20
): Promise<BybitExecution[]> {
  const r = await call<ExecListResult>("get", "/v5/execution/list", {
    category: "linear",
    symbol,
    limit,
  });
  return r.list ?? [];
}

// Test seam: lets the test suite swap in a mocked axios without touching
// production code paths.
export const __testing = { client };

logger.info("Bybit client initialized", {
  testnet: config.BYBIT_TESTNET,
  hasKey: Boolean(config.BYBIT_API_KEY),
});
