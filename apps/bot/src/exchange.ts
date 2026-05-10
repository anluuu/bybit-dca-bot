import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Typed errors

export class ExchangeApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "ExchangeApiError";
  }
}

export class ExchangeClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "ExchangeClientError";
  }
}

// Bybit V5 response shape

interface BybitResponse<T = unknown> {
  retCode: number;
  retMsg: string;
  result: T;
}

export interface OrderDetail {
  // Bybit V5 returns the field as `orderStatus` — NOT `status`. Using the
  // wrong name silently yields `undefined`, making every fill look like a
  // failure. Trips on this previously caused test orders to be marked
  // failed even when the trade actually settled on the exchange.
  orderStatus: string;
  price: string;
  qty: string;
  avgPrice: string;
  cumExecQty: string;
  cumExecValue: string;
  cumExecFee: string;
  /** Bybit sometimes omits this on spot fills; treat as optional. */
  feeCurrency: string | null;
}

// HMAC-SHA256 signing

function signRequest(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryOrBody: string
): string {
  const payload = timestamp + apiKey + recvWindow + queryOrBody;
  return crypto
    .createHmac("sha256", config.BYBIT_API_SECRET)
    .update(payload)
    .digest("hex");
}

// Axios instance with signing interceptor

const client: AxiosInstance = axios.create({
  baseURL: "https://api.bybit.com",
  timeout: 10_000,
});

client.interceptors.request.use((reqConfig: InternalAxiosRequestConfig) => {
  const timestamp = Date.now().toString();
  const recvWindow = "5000";

  let payload = "";
  if (reqConfig.method === "get" || reqConfig.method === "GET") {
    const params = new URLSearchParams(
      reqConfig.params as Record<string, string>
    );
    payload = params.toString();
  } else if (reqConfig.data) {
    payload = JSON.stringify(reqConfig.data);
  }

  const sign = signRequest(
    timestamp,
    config.BYBIT_API_KEY,
    recvWindow,
    payload
  );

  reqConfig.headers.set("X-BAPI-API-KEY", config.BYBIT_API_KEY);
  reqConfig.headers.set("X-BAPI-SIGN", sign);
  reqConfig.headers.set("X-BAPI-SIGN-TYPE", "2");
  reqConfig.headers.set("X-BAPI-TIMESTAMP", timestamp);
  reqConfig.headers.set("X-BAPI-RECV-WINDOW", recvWindow);
  reqConfig.headers.set("Content-Type", "application/json");

  return reqConfig;
});

// Handle Bybit API response codes

function handleResponse<T>(data: BybitResponse<T>, context: string): T {
  if (data.retCode === 0) return data.result;

  const msg = `${context}: ${data.retMsg} (code: ${data.retCode})`;

  // Non-retryable error codes. Input/validation failures must NOT be retried:
  // every retry repeats the same bad payload, wastes the retry budget, and
  // delays visibility of the real bug. 170130–170140 covers Bybit's spot
  // order-validation family (price decimals, qty decimals, min qty, etc.)
  // incl. 170134 seen 2026-04-19.
  const nonRetryable = [
    10001,
    10003,
    10004,
    10005,
    110001,
    170130, // invalid order qty
    170131,
    170132,
    170133,
    170134, // price has too many decimals
    170135,
    170136,
    170137, // qty has too many decimals
    170138,
    170139,
    170140, // order value too small
  ];
  if (nonRetryable.includes(data.retCode)) {
    throw new ExchangeClientError(msg, data.retCode);
  }

  throw new ExchangeApiError(msg, data.retCode);
}

// Public API

export async function getTickerPrice(pair: string): Promise<number> {
  try {
    const { data } = await client.get<
      BybitResponse<{ list: Array<{ lastPrice: string }> }>
    >("/v5/market/tickers", {
      params: { category: "spot", symbol: pair },
    });

    const result = handleResponse(data, "getTickerPrice");
    if (!result.list?.[0]) {
      throw new ExchangeClientError(`No ticker data for ${pair}`);
    }
    const price = parseFloat(result.list[0].lastPrice);
    logger.info("Fetched ticker price", { pair, price });
    return price;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `getTickerPrice failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function placeLimitOrder(
  pair: string,
  qty: string,
  price: string
): Promise<string> {
  try {
    const { data } = await client.post<
      BybitResponse<{ orderId: string }>
    >("/v5/order/create", {
      category: "spot",
      symbol: pair,
      side: "Buy",
      orderType: "Limit",
      qty,
      price,
      timeInForce: "GTC",
    });

    const result = handleResponse(data, "placeLimitOrder");
    logger.info("Limit order placed", {
      pair,
      qty,
      price,
      orderId: result.orderId,
    });
    return result.orderId;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `placeLimitOrder failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function placeMarketOrder(
  pair: string,
  quoteAmount: string
): Promise<string> {
  try {
    const { data } = await client.post<
      BybitResponse<{ orderId: string }>
    >("/v5/order/create", {
      category: "spot",
      symbol: pair,
      side: "Buy",
      orderType: "Market",
      qty: quoteAmount,
      marketUnit: "quoteCoin",
    });

    const result = handleResponse(data, "placeMarketOrder");
    logger.info("Market order placed", {
      pair,
      quoteAmount,
      orderId: result.orderId,
    });
    return result.orderId;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `placeMarketOrder failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function cancelOrder(
  pair: string,
  orderId: string
): Promise<void> {
  try {
    const { data } = await client.post<BybitResponse>("/v5/order/cancel", {
      category: "spot",
      symbol: pair,
      orderId,
    });

    handleResponse(data, "cancelOrder");
    logger.info("Order cancelled", { pair, orderId });
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `cancelOrder failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getOrderDetail(
  pair: string,
  orderId: string
): Promise<OrderDetail> {
  try {
    const { data } = await client.get<
      BybitResponse<{ list: Array<OrderDetail> }>
    >("/v5/order/realtime", {
      params: { category: "spot", symbol: pair, orderId },
    });

    const result = handleResponse(data, "getOrderDetail");
    if (!result.list?.[0]) {
      throw new ExchangeApiError(`No order detail for ${orderId}`);
    }
    return result.list[0];
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `getOrderDetail failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getSpotBalance(coin: string): Promise<number> {
  try {
    const { data } = await client.get<
      BybitResponse<{
        list: Array<{
          coin: Array<{ coin: string; availableToWithdraw: string }>;
        }>;
      }>
    >("/v5/account/wallet-balance", {
      params: { accountType: "UNIFIED", coin },
    });

    const result = handleResponse(data, "getSpotBalance");
    const coinData = result.list[0]?.coin?.find(
      (c) => c.coin === coin
    );
    const balance = coinData ? parseFloat(coinData.availableToWithdraw) : 0;
    logger.info("Fetched balance", { coin, balance });
    return balance;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `getSpotBalance failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getFundingBalance(coin: string): Promise<number> {
  try {
    const { data } = await client.get<
      BybitResponse<{ balance: { walletBalance: string | null } }>
    >("/v5/asset/transfer/query-account-coin-balance", {
      params: { accountType: "FUND", coin },
    });

    const result = handleResponse(data, "getFundingBalance");
    const raw = result.balance?.walletBalance;
    const balance = raw ? parseFloat(raw) : 0;
    logger.info("Fetched funding balance", { coin, balance });
    return balance;
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `getFundingBalance failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function transferFundingToSpot(
  coin: string,
  amount: number
): Promise<{ transferId: string }> {
  // Bybit dedupes inter-account transfers by transferId for ~24h. Generate
  // fresh per call — a retry of the parent DCA job will get a new UUID, but
  // by then the previous transfer (if it actually settled server-side) has
  // already topped up Spot, so the second call short-circuits at the
  // getSpotBalance pre-check in ensureSpotBalance.
  const transferId = crypto.randomUUID();
  const body = {
    transferId,
    coin,
    amount: amount.toFixed(2),
    fromAccountType: "FUND",
    toAccountType: "UNIFIED",
  };

  try {
    const { data } = await client.post<
      BybitResponse<{ transferId: string; status: string }>
    >("/v5/asset/transfer/inter-transfer", body);

    const result = handleResponse(data, "transferFundingToSpot");
    logger.info("Transferred funds", {
      coin,
      amount: body.amount,
      transferId: result.transferId,
      status: result.status,
    });
    return { transferId: result.transferId };
  } catch (error) {
    if (
      error instanceof ExchangeApiError ||
      error instanceof ExchangeClientError
    )
      throw error;
    throw new ExchangeApiError(
      `transferFundingToSpot failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
