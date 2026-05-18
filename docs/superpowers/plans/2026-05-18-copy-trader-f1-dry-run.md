# Copy-Trader F1 (Dry-Run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bybit V5 perp executor + risk gate + position watcher to the live `apps/copy-trader` service. F1 ships with `DRY_RUN=true` so no real orders are placed — instead, every signal that passes the gate is fully *planned* (sized, price-checked, leverage capped) and recorded in `copy_trader.trades` with `status='DRY_RUN_LOGGED'`. F2 flips the flag.

**Architecture:** The existing F0 listener already ingests Mack's signals from topic 4. F1 wires `executor.execute(signal)` into the post-parse path. The executor calls `riskGate.evaluate(signal)`; on pass, computes position size from `MAX_RISK_PCT × balance / SL distance`, caps leverage at `MAX_LEVERAGE`, decides MARKET vs LIMIT_CHASE entry, and (in dry-run) inserts a `trades` row without calling Bybit. The position watcher (`watcher.ts`) is a BullMQ repeatable job that polls open Bybit positions every 30 s, reconciling state into `trades` and tripping daily-loss / cooldown / kill-switch in `system_state`. Tables exist already from F0's migration 0000.

**Tech Stack:** TypeScript ESM, axios (HMAC-signed Bybit V5 client), BullMQ + ioredis, Drizzle ORM, Vitest. Tests mock the Bybit HTTP boundary; no real exchange calls in CI.

**Scope boundary:** F1 ships dry-run + watcher reconciliation only. F2 is the env-var flip + first live trade and gets its own plan. Live trading on mainnet stays off behind `DRY_RUN=true` until that plan executes.

**Operator prerequisite (done in parallel by user):**

1. Create a Bybit sub-account (UID separate from the DCA bot's).
2. Generate an API key under that sub-account with permissions **Derivatives → Read & Trade** only (no Withdrawal, no Spot if you can disable it).
3. Fund the sub-account with ~50 USDT.
4. After F1 ships, paste `BYBIT_API_KEY` / `BYBIT_API_SECRET` into Dokploy.

The code is written defensively so it boots and dry-runs against a real API key — if the key is invalid, the executor logs the error and skips the trade; the listener keeps running. So you can deploy F1 with placeholder env values and fix them later.

---

## File Structure

### New files in `apps/copy-trader/src/`

```
apps/copy-trader/src/
├── bybit.ts                # HMAC-signed Bybit V5 client (mirrors apps/bot/src/exchange.ts)
├── instrumentInfo.ts       # Cache of qtyStep / tickSize / minOrderQty per symbol
├── sizing.ts               # Pure math: risk-based position size + quantization
├── sizing.test.ts          # Vitest unit tests
├── configStore.ts          # Read/write copy_trader.config rows
├── riskGate.ts             # 8 sequential gates + sanity checks
├── riskGate.test.ts        # Vitest unit tests
├── executor.ts             # Plan + (dry-run | live) order placement
├── executor.test.ts        # Vitest unit tests (mocked Bybit)
├── queue.ts                # BullMQ connection + watcher job registration
└── watcher.ts              # Reconcile trades against Bybit state
```

### Modified files

```
apps/copy-trader/package.json       # add axios, bullmq, ioredis
apps/copy-trader/src/config.ts      # add Bybit + Redis + Bootstrap env vars
apps/copy-trader/src/listener.ts    # call executor.execute on parse OK
apps/copy-trader/src/server.ts      # add /api/copy/{trades,stats,system-state,config} endpoints
apps/copy-trader/src/index.ts       # seed config defaults, init initial_capital, start watcher
packages/shared/src/index.ts        # add CopyTrade, CopyStats, CopySystemState, CopyConfig types
apps/web/src/lib/api.ts             # re-export new types
apps/web/src/components/copy/       # new components below
apps/web/src/pages/CopyTraderPage.tsx  # render new components
docker-compose.yml                  # add BYBIT_*, REDIS_URL, initial-capital env passthrough
.env.example                        # add same
```

### New web components

```
apps/web/src/components/copy/
├── TradesTable.tsx         # paginated trades, status filter
├── StatsCard.tsx           # today / 7d / all-time PnL + win rate
├── SystemStatePanel.tsx    # kill switch, cooldown, initial capital, drawdown
└── ConfigForm.tsx          # editable config table values with validation
```

---

## Task 1: Add F1 dependencies

**Files:**
- Modify: `apps/copy-trader/package.json`

- [ ] **Step 1: Add dependencies**

Open `apps/copy-trader/package.json`. Insert `axios`, `bullmq`, `ioredis` into `"dependencies"` so the block reads:

```json
  "dependencies": {
    "@dca/shared": "workspace:*",
    "@fastify/cookie": "^11.0.2",
    "@fastify/jwt": "^10.0.0",
    "axios": "^1.15.0",
    "bullmq": "^5.73.5",
    "drizzle-orm": "^0.45.2",
    "fastify": "^5.8.4",
    "input": "^1.0.1",
    "ioredis": "^5.10.1",
    "postgres": "^3.4.9",
    "telegraf": "^4.16.3",
    "telegram": "^2.26.22",
    "zod": "^4.3.6"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updated.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS (no source changes yet).

- [ ] **Step 4: Commit**

```bash
git add apps/copy-trader/package.json pnpm-lock.yaml
git commit -m "feat(copy-trader): add axios + bullmq + ioredis for F1"
```

---

## Task 2: Extend config with Bybit + Redis + initial capital env

**Files:**
- Modify: `apps/copy-trader/src/config.ts`

- [ ] **Step 1: Add env vars to Zod schema**

Open `apps/copy-trader/src/config.ts`. Insert the new vars in the appropriate sections so the schema is:

```typescript
import { z } from "zod/v4";

const configSchema = z.object({
  // Telegram MTProto user session (NOT a bot token)
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_SESSION_STRING: z.string().min(1),
  SIGNAL_CHANNEL_ID: z.coerce.number().int(),
  SIGNAL_TOPIC_ID: z.coerce.number().int().optional(),

  // Telegram notification bot (separate, telegraf)
  TELEGRAM_NOTIFY_BOT_TOKEN: z.string().min(1),
  TELEGRAM_NOTIFY_CHAT_ID: z.string().min(1),

  // Postgres
  DATABASE_URL: z.string().startsWith("postgres"),

  // Redis (BullMQ for the position watcher)
  REDIS_URL: z.string().startsWith("redis").default("redis://localhost:6379"),

  // Bybit (perpetual futures sub-account). Empty defaults allow F1 to boot
  // and dry-run even before the operator has wired the real key — the
  // executor logs a soft error per attempt and the watcher idles.
  BYBIT_API_KEY: z.string().default(""),
  BYBIT_API_SECRET: z.string().default(""),
  BYBIT_TESTNET: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => (typeof v === "boolean" ? v : v === "true")),

  // Optional override of the initial-capital baseline used for max-drawdown
  // kill switch. When empty, the executor populates system_state.initial_capital
  // from Bybit's reported wallet balance on first boot.
  INITIAL_CAPITAL_USDT_OVERRIDE: z.coerce.number().nonnegative().default(0),

  // Auth (shared with bot for dashboard SSO)
  JWT_SECRET: z.string().min(32),

  // Operation
  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Reconcile window
  BOOT_RECONCILE_LIMIT: z.coerce.number().int().min(0).max(500).default(50),

  // Optional CSV of Telegram sender IDs to whitelist. When non-empty, messages
  // from any other sender are dropped before they hit the parser or DB. Empty
  // = passthrough (ingest from anyone in the channel).
  COPY_TG_ALLOWED_SENDER_IDS: z.string().default(""),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

const parsed = result.data;
const allowedSenderIds = parsed.COPY_TG_ALLOWED_SENDER_IDS.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n));

export const config = Object.freeze({
  ...parsed,
  allowedSenderIds: new Set(allowedSenderIds),
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/config.ts
git commit -m "feat(copy-trader): config additions for Bybit, Redis, initial-capital baseline"
```

---

## Task 3: Bybit V5 client wrapper

**Files:**
- Create: `apps/copy-trader/src/bybit.ts`

This module is the only place that touches the Bybit HTTP API. It exposes a small typed surface — `getWalletBalanceUsdt`, `setLeverage`, `setMarginModeIsolated`, `getTicker`, `createOrder`, `getOrder`, `getPosition`, `getRecentExecutions` — and converts Bybit's `retCode` into our two error classes. Mirrors `apps/bot/src/exchange.ts`'s shape.

- [ ] **Step 1: Write the module**

Create `apps/copy-trader/src/bybit.ts`:

```typescript
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

export async function setLeverage(symbol: string, leverage: number): Promise<void> {
  try {
    await call<unknown>("post", "/v5/position/set-leverage", {
      category: "linear",
      symbol,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    });
  } catch (e) {
    if (e instanceof ExchangeClientError && e.retCode === 110043) return; // not modified
    throw e;
  }
}

export async function setMarginModeIsolated(
  symbol: string,
  leverage: number
): Promise<void> {
  try {
    await call<unknown>("post", "/v5/position/switch-isolated", {
      category: "linear",
      symbol,
      tradeMode: 1,
      buyLeverage: String(leverage),
      sellLeverage: String(leverage),
    });
  } catch (e) {
    if (e instanceof ExchangeClientError && e.retCode === 110026) return; // not modified
    throw e;
  }
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/bybit.ts
git commit -m "feat(copy-trader): Bybit V5 client wrapper (HMAC-signed, typed surface)"
```

---

## Task 4: Instrument info cache

**Files:**
- Create: `apps/copy-trader/src/instrumentInfo.ts`

`getInstrumentInfo` hits Bybit every call; we cache per-symbol because qtyStep / tickSize never change at runtime.

- [ ] **Step 1: Write the module**

Create `apps/copy-trader/src/instrumentInfo.ts`:

```typescript
import { getInstrumentInfo as fetchFromBybit } from "./bybit.js";

export interface InstrumentSpec {
  symbol: string;
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  tickSize: number;
}

const cache = new Map<string, Promise<InstrumentSpec>>();

export async function getInstrumentSpec(symbol: string): Promise<InstrumentSpec> {
  const existing = cache.get(symbol);
  if (existing) return existing;
  const p = (async () => {
    const raw = await fetchFromBybit(symbol);
    const spec: InstrumentSpec = {
      symbol: raw.symbol,
      qtyStep: Number(raw.lotSizeFilter.qtyStep),
      minOrderQty: Number(raw.lotSizeFilter.minOrderQty),
      maxOrderQty: Number(raw.lotSizeFilter.maxOrderQty),
      tickSize: Number(raw.priceFilter.tickSize),
    };
    return spec;
  })();
  cache.set(symbol, p);
  // Drop cache entry if the fetch failed so the next caller can retry.
  p.catch(() => cache.delete(symbol));
  return p;
}

// Test seam: lets tests clear or pre-populate the cache.
export function __resetCache(): void {
  cache.clear();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/instrumentInfo.ts
git commit -m "feat(copy-trader): per-symbol instrument info cache"
```

---

## Task 5: Position sizing math (TDD)

**Files:**
- Create: `apps/copy-trader/src/sizing.ts`
- Create: `apps/copy-trader/src/sizing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/copy-trader/src/sizing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computePositionPlan } from "./sizing.js";

describe("computePositionPlan", () => {
  const spec = { symbol: "BTCUSDT", qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100, tickSize: 0.1 };

  it("sizes a SHORT so SL distance equals the risk budget", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000, // 5% above entry → SL distance 5%
      leverageUsed: 10,
      instrument: spec,
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    // risk = 1000 * 2% = 20 USDT; position = 20 / 0.05 = 400 USDT;
    // qty = 400 / 80000 = 0.005 BTC; quantized to step 0.001 = 0.005
    expect(plan.qty).toBeCloseTo(0.005, 6);
    expect(plan.positionUsdt).toBeCloseTo(400, 4);
    expect(plan.marginUsdt).toBeCloseTo(40, 4); // 400 / 10x
  });

  it("rounds qty DOWN to the symbol's qtyStep", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "LONG",
      entryPrice: 80000,
      stopLoss: 76000, // 5%
      leverageUsed: 10,
      instrument: { ...spec, qtyStep: 0.01 },
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    // raw qty 0.005, qtyStep 0.01 → quantized 0.00 → below minOrderQty (0.001)
    expect(plan.qty).toBe(0); // helper signals BALANCE_TOO_SMALL via kind below in real flow
  });

  it("rejects when the quantized qty is below minOrderQty", () => {
    const plan = computePositionPlan({
      balanceUsdt: 10, // very small
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000,
      leverageUsed: 10,
      instrument: spec,
    });
    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.reason).toBe("BALANCE_TOO_SMALL");
  });

  it("rejects when entry equals SL (zero risk distance)", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "LONG",
      entryPrice: 80000,
      stopLoss: 80000,
      leverageUsed: 10,
      instrument: spec,
    });
    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.reason).toBe("SL_AT_ENTRY");
  });

  it("clamps qty at maxOrderQty when the budget exceeds it", () => {
    const plan = computePositionPlan({
      balanceUsdt: 10_000_000, // absurd
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000,
      leverageUsed: 10,
      instrument: { ...spec, maxOrderQty: 1 },
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.qty).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm --filter @dca/copy-trader test`
Expected: 5 tests FAIL with `Cannot find module './sizing.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/copy-trader/src/sizing.ts`:

```typescript
import type { InstrumentSpec } from "./instrumentInfo.js";

export type SizingInput = {
  balanceUsdt: number;
  maxRiskPct: number;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  leverageUsed: number;
  instrument: InstrumentSpec;
};

export type SizingResult =
  | {
      kind: "ok";
      qty: number;
      positionUsdt: number;
      marginUsdt: number;
      slDistancePct: number;
    }
  | { kind: "error"; reason: "SL_AT_ENTRY" | "BALANCE_TOO_SMALL" };

function quantizeFloor(value: number, step: number): number {
  if (step <= 0) return value;
  const factor = 1 / step;
  return Math.floor(value * factor) / factor;
}

export function computePositionPlan(input: SizingInput): SizingResult {
  const { balanceUsdt, maxRiskPct, entryPrice, stopLoss, leverageUsed, instrument } = input;

  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance === 0) return { kind: "error", reason: "SL_AT_ENTRY" };
  const slDistancePct = slDistance / entryPrice;

  const riskUsdt = balanceUsdt * (maxRiskPct / 100);
  const rawPositionUsdt = riskUsdt / slDistancePct;
  const rawQty = rawPositionUsdt / entryPrice;

  const cappedQty = Math.min(rawQty, instrument.maxOrderQty);
  const qty = quantizeFloor(cappedQty, instrument.qtyStep);

  if (qty < instrument.minOrderQty) {
    return { kind: "error", reason: "BALANCE_TOO_SMALL" };
  }

  const positionUsdt = qty * entryPrice;
  const marginUsdt = positionUsdt / leverageUsed;

  return { kind: "ok", qty, positionUsdt, marginUsdt, slDistancePct };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm --filter @dca/copy-trader test`
Expected: All 5 sizing tests pass (plus the 10 from F0).

- [ ] **Step 5: Commit**

```bash
git add apps/copy-trader/src/sizing.ts apps/copy-trader/src/sizing.test.ts
git commit -m "feat(copy-trader): risk-based position sizing module with tests"
```

---

## Task 6: Config store (read/write copy_trader.config)

**Files:**
- Create: `apps/copy-trader/src/configStore.ts`

- [ ] **Step 1: Write the module**

Create `apps/copy-trader/src/configStore.ts`:

```typescript
import { db } from "./db/client.js";
import { configTable } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// Default values, applied by `seedDefaults()` on boot when the table is empty.
// Keys mirror spec section 6 (Mutable config) — units are already encoded
// in the keys themselves (PCT, MIN, USDT).
export const CONFIG_DEFAULTS: Record<string, string> = {
  MAX_RISK_PCT: "2.0",
  MAX_LEVERAGE: "10",
  MAX_OPEN_POSITIONS: "3",
  DAILY_LOSS_LIMIT_PCT: "10.0",
  MAX_DRAWDOWN_PCT: "30.0",
  COOLDOWN_MIN_AFTER_LOSS: "30",
  CHASE_TOLERANCE_PCT: "0.5",
  CHASE_TIMEOUT_MIN: "10",
  MIN_RR_RATIO: "0.5",
  WHITELIST_SYMBOLS: "BTCUSDT,ETHUSDT",
  DRY_RUN: "true",
};

// Validation rules used by the PUT endpoint in server.ts. Min/max are
// inclusive bounds; sets are exhaustive allowed values; bool accepts the two
// strings.
type Validator =
  | { kind: "number"; min: number; max: number }
  | { kind: "bool" }
  | { kind: "csv" };

export const CONFIG_VALIDATORS: Record<string, Validator> = {
  MAX_RISK_PCT: { kind: "number", min: 0.1, max: 5 },
  MAX_LEVERAGE: { kind: "number", min: 1, max: 20 },
  MAX_OPEN_POSITIONS: { kind: "number", min: 1, max: 10 },
  DAILY_LOSS_LIMIT_PCT: { kind: "number", min: 1, max: 50 },
  MAX_DRAWDOWN_PCT: { kind: "number", min: 5, max: 80 },
  COOLDOWN_MIN_AFTER_LOSS: { kind: "number", min: 0, max: 1440 },
  CHASE_TOLERANCE_PCT: { kind: "number", min: 0, max: 5 },
  CHASE_TIMEOUT_MIN: { kind: "number", min: 1, max: 60 },
  MIN_RR_RATIO: { kind: "number", min: 0.1, max: 10 },
  WHITELIST_SYMBOLS: { kind: "csv" },
  DRY_RUN: { kind: "bool" },
};

export function validateConfigValue(key: string, value: string): string | null {
  const v = CONFIG_VALIDATORS[key];
  if (!v) return `Unknown key ${key}`;
  if (v.kind === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Not a number";
    if (n < v.min || n > v.max) return `Out of range [${v.min}, ${v.max}]`;
  } else if (v.kind === "bool") {
    if (value !== "true" && value !== "false") return "Must be 'true' or 'false'";
  } else if (v.kind === "csv") {
    if (value.length === 0) return "Empty CSV";
  }
  return null;
}

export async function seedDefaults(): Promise<void> {
  const existing = await db.select({ key: configTable.key }).from(configTable);
  const have = new Set(existing.map((r) => r.key));
  const missing = Object.entries(CONFIG_DEFAULTS).filter(([k]) => !have.has(k));
  if (missing.length === 0) return;
  await db
    .insert(configTable)
    .values(missing.map(([key, value]) => ({ key, value })));
  logger.info("Seeded config defaults", { count: missing.length, keys: missing.map(([k]) => k) });
}

export async function getConfig(key: string): Promise<string> {
  const rows = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .limit(1);
  const v = rows[0]?.value;
  if (v !== undefined) return v;
  const def = CONFIG_DEFAULTS[key];
  if (def !== undefined) return def;
  throw new Error(`Config key ${key} not found and no default`);
}

export async function getConfigNumber(key: string): Promise<number> {
  return Number(await getConfig(key));
}

export async function getConfigBool(key: string): Promise<boolean> {
  return (await getConfig(key)) === "true";
}

export async function getConfigCsv(key: string): Promise<string[]> {
  return (await getConfig(key))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function setConfig(key: string, value: string): Promise<void> {
  const err = validateConfigValue(key, value);
  if (err) throw new Error(`Invalid value for ${key}: ${err}`);
  await db
    .insert(configTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: configTable.key, set: { value, updatedAt: new Date() } });
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(configTable);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/configStore.ts
git commit -m "feat(copy-trader): runtime config store with defaults + validation"
```

---

## Task 7: Risk gate (8 gates + sanity, TDD)

**Files:**
- Create: `apps/copy-trader/src/riskGate.ts`
- Create: `apps/copy-trader/src/riskGate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/copy-trader/src/riskGate.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateRiskGate, type GateContext, type GateSignal } from "./riskGate.js";

const baseSignal: GateSignal = {
  signalHash: "h1",
  direction: "SHORT",
  symbol: "BTCUSDT",
  entryLow: 79400,
  entryHigh: 79900,
  stopLoss: 83000,
  takeProfit1: 76400,
  leverageRaw: 15,
};

function ctx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    config: {
      MAX_OPEN_POSITIONS: 3,
      DAILY_LOSS_LIMIT_PCT: 10,
      MAX_DRAWDOWN_PCT: 30,
      CHASE_TOLERANCE_PCT: 0.5,
      MIN_RR_RATIO: 0.5,
      WHITELIST_SYMBOLS: ["BTCUSDT", "ETHUSDT"],
    },
    state: {
      killed: false,
      killedReason: null,
      cooldownUntil: null,
      initialCapital: 1000,
    },
    balance: 1000,
    openCount: 0,
    dayPnl: 0,
    dayBalanceStart: 1000,
    lastPrice: 79600, // inside the range
    now: new Date("2026-05-18T18:00:00Z"),
    ...overrides,
  };
}

describe("evaluateRiskGate", () => {
  it("passes a clean SHORT inside the entry range with MARKET entry", () => {
    const r = evaluateRiskGate(baseSignal, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryStrategy).toBe("MARKET");
  });

  it("returns LIMIT_CHASE when price is within tolerance but outside range (SHORT)", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ lastPrice: 80100 })); // 0.25% above high
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryStrategy).toBe("LIMIT_CHASE");
    expect(r.limitPrice).toBe(79900);
  });

  it("rejects when price is past the chase tolerance", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ lastPrice: 81000 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("PRICE_TOO_FAR");
  });

  it("rejects when kill switch is active", () => {
    const r = evaluateRiskGate(
      baseSignal,
      ctx({ state: { killed: true, killedReason: "TEST", cooldownUntil: null, initialCapital: 1000 } })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("rejects symbol not in whitelist", () => {
    const r = evaluateRiskGate({ ...baseSignal, symbol: "1000PEPEUSDT" }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("SYMBOL_NOT_WHITELISTED");
  });

  it("rejects when in cooldown", () => {
    const r = evaluateRiskGate(
      baseSignal,
      ctx({
        state: {
          killed: false,
          killedReason: null,
          cooldownUntil: new Date("2026-05-18T19:00:00Z"),
          initialCapital: 1000,
        },
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("COOLDOWN_AFTER_LOSS");
  });

  it("rejects when at max open positions", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ openCount: 3 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("MAX_OPEN_POSITIONS");
  });

  it("rejects when daily loss limit hit", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ dayPnl: -150 })); // -15% of 1000
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("DAILY_LOSS_LIMIT");
  });

  it("trips KILL_SWITCH_DRAWDOWN when balance fell past max drawdown", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ balance: 600 })); // 40% drawdown vs initialCapital 1000
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("KILL_SWITCH_DRAWDOWN");
  });

  it("rejects directional incoherence (SHORT with SL below entry)", () => {
    const r = evaluateRiskGate(
      { ...baseSignal, stopLoss: 79000 },
      ctx()
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("INVALID_SIGNAL_SL");
  });

  it("rejects low reward:risk ratio", () => {
    // SHORT entry ~79650, SL 83000 → risk 3350. TP at 79640 → reward 10 → R:R 0.003
    const r = evaluateRiskGate({ ...baseSignal, takeProfit1: 79640 }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("RR_TOO_LOW");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm --filter @dca/copy-trader test`
Expected: 11 tests FAIL with `Cannot find module './riskGate.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/copy-trader/src/riskGate.ts`:

```typescript
export type GateSignal = {
  signalHash: string;
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  leverageRaw: number;
};

export type GateContext = {
  config: {
    MAX_OPEN_POSITIONS: number;
    DAILY_LOSS_LIMIT_PCT: number;
    MAX_DRAWDOWN_PCT: number;
    CHASE_TOLERANCE_PCT: number;
    MIN_RR_RATIO: number;
    WHITELIST_SYMBOLS: string[];
  };
  state: {
    killed: boolean;
    killedReason: string | null;
    cooldownUntil: Date | null;
    initialCapital: number;
  };
  balance: number;
  openCount: number;
  dayPnl: number;
  dayBalanceStart: number;
  lastPrice: number;
  now: Date;
};

export type GateResult =
  | {
      ok: true;
      entryStrategy: "MARKET" | "LIMIT_CHASE";
      limitPrice?: number;
    }
  | {
      ok: false;
      reason:
        | "KILL_SWITCH_ACTIVE"
        | "SYMBOL_NOT_WHITELISTED"
        | "COOLDOWN_AFTER_LOSS"
        | "MAX_OPEN_POSITIONS"
        | "DAILY_LOSS_LIMIT"
        | "KILL_SWITCH_DRAWDOWN"
        | "PRICE_TOO_FAR"
        | "INVALID_SIGNAL_SL"
        | "INVALID_SIGNAL_TP"
        | "RR_TOO_LOW";
      meta?: Record<string, unknown>;
    };

export function evaluateRiskGate(signal: GateSignal, c: GateContext): GateResult {
  // G1: Kill switch
  if (c.state.killed) {
    return { ok: false, reason: "KILL_SWITCH_ACTIVE", meta: { killedReason: c.state.killedReason } };
  }

  // G2 (whitelist)
  if (!c.config.WHITELIST_SYMBOLS.includes(signal.symbol)) {
    return { ok: false, reason: "SYMBOL_NOT_WHITELISTED", meta: { symbol: signal.symbol } };
  }

  // G3 (cooldown)
  if (c.state.cooldownUntil && c.state.cooldownUntil > c.now) {
    return { ok: false, reason: "COOLDOWN_AFTER_LOSS", meta: { until: c.state.cooldownUntil.toISOString() } };
  }

  // G4 (max open)
  if (c.openCount >= c.config.MAX_OPEN_POSITIONS) {
    return { ok: false, reason: "MAX_OPEN_POSITIONS", meta: { openCount: c.openCount } };
  }

  // G5 (daily loss)
  if (c.dayBalanceStart > 0) {
    const lossPct = (-c.dayPnl / c.dayBalanceStart) * 100;
    if (lossPct >= c.config.DAILY_LOSS_LIMIT_PCT) {
      return { ok: false, reason: "DAILY_LOSS_LIMIT", meta: { lossPct } };
    }
  }

  // G6 (drawdown)
  if (c.state.initialCapital > 0) {
    const drawdownPct = ((c.state.initialCapital - c.balance) / c.state.initialCapital) * 100;
    if (drawdownPct >= c.config.MAX_DRAWDOWN_PCT) {
      return { ok: false, reason: "KILL_SWITCH_DRAWDOWN", meta: { drawdownPct } };
    }
  }

  // Sanity: SL direction
  if (signal.direction === "LONG" && signal.stopLoss >= signal.entryLow) {
    return { ok: false, reason: "INVALID_SIGNAL_SL" };
  }
  if (signal.direction === "SHORT" && signal.stopLoss <= signal.entryHigh) {
    return { ok: false, reason: "INVALID_SIGNAL_SL" };
  }

  // Sanity: TP direction
  if (signal.direction === "LONG" && signal.takeProfit1 <= signal.entryHigh) {
    return { ok: false, reason: "INVALID_SIGNAL_TP" };
  }
  if (signal.direction === "SHORT" && signal.takeProfit1 >= signal.entryLow) {
    return { ok: false, reason: "INVALID_SIGNAL_TP" };
  }

  // R:R
  const entryMid = (signal.entryLow + signal.entryHigh) / 2;
  const risk = Math.abs(entryMid - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit1 - entryMid);
  if (risk > 0 && reward / risk < c.config.MIN_RR_RATIO) {
    return { ok: false, reason: "RR_TOO_LOW", meta: { rr: reward / risk } };
  }

  // G7 (price in chase range)
  const tolerance = signal.entryHigh * (c.config.CHASE_TOLERANCE_PCT / 100);
  const expandedLow = signal.entryLow - tolerance;
  const expandedHigh = signal.entryHigh + tolerance;
  if (c.lastPrice >= signal.entryLow && c.lastPrice <= signal.entryHigh) {
    return { ok: true, entryStrategy: "MARKET" };
  }
  if (c.lastPrice >= expandedLow && c.lastPrice <= expandedHigh) {
    const limitPrice = signal.direction === "LONG" ? signal.entryLow : signal.entryHigh;
    return { ok: true, entryStrategy: "LIMIT_CHASE", limitPrice };
  }
  return { ok: false, reason: "PRICE_TOO_FAR", meta: { lastPrice: c.lastPrice } };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm --filter @dca/copy-trader test`
Expected: 11 risk gate tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/copy-trader/src/riskGate.ts apps/copy-trader/src/riskGate.test.ts
git commit -m "feat(copy-trader): risk gate with 8 guardrails + sanity checks (TDD)"
```

---

## Task 8: Executor — dry-run + live branches

**Files:**
- Create: `apps/copy-trader/src/executor.ts`
- Create: `apps/copy-trader/src/executor.test.ts`

- [ ] **Step 1: Write tests (mock Bybit + DB)**

Create `apps/copy-trader/src/executor.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the bybit client surface used by executor.
vi.mock("./bybit.js", () => ({
  ExchangeApiError: class extends Error {},
  ExchangeClientError: class extends Error {},
  setLeverage: vi.fn(async () => undefined),
  setMarginModeIsolated: vi.fn(async () => undefined),
  createOrder: vi.fn(async () => ({ orderId: "BYBIT-ORDER-1", orderLinkId: "copy-h1abc" })),
  getLastPrice: vi.fn(async () => 79600),
  getWalletBalanceUsdt: vi.fn(async () => 1000),
}));

vi.mock("./instrumentInfo.js", () => ({
  getInstrumentSpec: vi.fn(async () => ({
    symbol: "BTCUSDT",
    qtyStep: 0.001,
    minOrderQty: 0.001,
    maxOrderQty: 100,
    tickSize: 0.1,
  })),
}));

// Drizzle insert is a chain; mock returns the inserted row id.
const insertedRows: any[] = [];
vi.mock("./db/client.js", () => {
  return {
    db: {
      insert: () => ({
        values: (v: any) => ({
          returning: async () => {
            insertedRows.push(v);
            return [{ id: "trade-1" }];
          },
        }),
      }),
    },
  };
});

import { executeSignal, type ExecutorSignal } from "./executor.js";
import { createOrder, setLeverage } from "./bybit.js";

const sig: ExecutorSignal = {
  signalId: "sig-1",
  signalHash: "h1abc",
  direction: "SHORT",
  symbol: "BTCUSDT",
  entryLow: 79400,
  entryHigh: 79900,
  stopLoss: 83000,
  takeProfit1: 76400,
  leverageRaw: 15,
};

beforeEach(() => {
  insertedRows.length = 0;
  vi.clearAllMocks();
});

describe("executeSignal — DRY_RUN", () => {
  it("inserts DRY_RUN_LOGGED row and does NOT call Bybit createOrder", async () => {
    await executeSignal(sig, {
      dryRun: true,
      maxLeverage: 10,
      maxRiskPct: 2,
      balanceUsdt: 1000,
      lastPrice: 79600,
      entryStrategy: "MARKET",
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(insertedRows[0].status).toBe("DRY_RUN_LOGGED");
    expect(insertedRows[0].dryRun).toBe(true);
    expect(insertedRows[0].leverageUsed).toBe(10); // capped from 15
  });
});

describe("executeSignal — live", () => {
  it("calls setLeverage + createOrder + inserts PENDING_FILL", async () => {
    await executeSignal(sig, {
      dryRun: false,
      maxLeverage: 10,
      maxRiskPct: 2,
      balanceUsdt: 1000,
      lastPrice: 79600,
      entryStrategy: "MARKET",
    });
    expect(setLeverage).toHaveBeenCalledWith("BTCUSDT", 10);
    expect(createOrder).toHaveBeenCalledOnce();
    expect(insertedRows[0].status).toBe("PENDING_FILL");
    expect(insertedRows[0].dryRun).toBe(false);
    expect(insertedRows[0].bybitOrderId).toBe("BYBIT-ORDER-1");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm --filter @dca/copy-trader test`
Expected: 2 tests FAIL with `Cannot find module './executor.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/copy-trader/src/executor.ts`:

```typescript
import { db } from "./db/client.js";
import { trades, signals } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  createOrder,
  setLeverage,
  setMarginModeIsolated,
  ExchangeApiError,
  ExchangeClientError,
} from "./bybit.js";
import { getInstrumentSpec } from "./instrumentInfo.js";
import { computePositionPlan } from "./sizing.js";

export type ExecutorSignal = {
  signalId: string;
  signalHash: string;
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  leverageRaw: number;
};

export type ExecuteOptions = {
  dryRun: boolean;
  maxLeverage: number;
  maxRiskPct: number;
  balanceUsdt: number;
  lastPrice: number;
  entryStrategy: "MARKET" | "LIMIT_CHASE";
  limitPrice?: number;
  chaseTimeoutMin?: number;
};

export async function executeSignal(
  signal: ExecutorSignal,
  opts: ExecuteOptions
): Promise<void> {
  const leverageUsed = Math.min(signal.leverageRaw, opts.maxLeverage);
  const instrument = await getInstrumentSpec(signal.symbol);

  const entryPrice =
    opts.entryStrategy === "LIMIT_CHASE" && opts.limitPrice != null
      ? opts.limitPrice
      : opts.lastPrice;

  const plan = computePositionPlan({
    balanceUsdt: opts.balanceUsdt,
    maxRiskPct: opts.maxRiskPct,
    direction: signal.direction,
    entryPrice,
    stopLoss: signal.stopLoss,
    leverageUsed,
    instrument,
  });

  if (plan.kind !== "ok") {
    await insertErrorTrade(signal, leverageUsed, plan.reason, opts.dryRun);
    logger.warn("Executor skipped — sizing error", {
      signalHash: signal.signalHash,
      reason: plan.reason,
    });
    return;
  }

  const orderLinkId = `copy-${signal.signalHash.slice(0, 16)}`;
  const limitExpiresAt =
    opts.entryStrategy === "LIMIT_CHASE" && opts.chaseTimeoutMin
      ? new Date(Date.now() + opts.chaseTimeoutMin * 60_000)
      : null;

  if (opts.dryRun) {
    const inserted = await db
      .insert(trades)
      .values({
        signalId: signal.signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        bybitOrderId: null,
        bybitOrderLinkId: orderLinkId,
        plannedQty: String(plan.qty),
        plannedMargin: String(plan.marginUsdt),
        leverageUsed,
        entryStrategy: opts.entryStrategy,
        limitPrice: opts.entryStrategy === "LIMIT_CHASE" ? String(opts.limitPrice ?? entryPrice) : null,
        limitExpiresAt,
        tpPrice: String(signal.takeProfit1),
        slPrice: String(signal.stopLoss),
        status: "DRY_RUN_LOGGED",
        dryRun: true,
      })
      .returning({ id: trades.id });
    await db.update(signals).set({ tradeId: inserted[0].id }).where(eq(signals.id, signal.signalId));
    logger.info("Dry-run logged", {
      signalHash: signal.signalHash,
      qty: plan.qty,
      leverageUsed,
      entryStrategy: opts.entryStrategy,
    });
    return;
  }

  // Live branch
  try {
    await setMarginModeIsolated(signal.symbol, leverageUsed);
    await setLeverage(signal.symbol, leverageUsed);
    const order = await createOrder({
      symbol: signal.symbol,
      side: signal.direction === "LONG" ? "Buy" : "Sell",
      orderType: opts.entryStrategy === "MARKET" ? "Market" : "Limit",
      qty: String(plan.qty),
      price: opts.entryStrategy === "LIMIT_CHASE" ? String(opts.limitPrice ?? entryPrice) : undefined,
      takeProfit: String(signal.takeProfit1),
      stopLoss: String(signal.stopLoss),
      orderLinkId,
    });
    const inserted = await db
      .insert(trades)
      .values({
        signalId: signal.signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        bybitOrderId: order.orderId,
        bybitOrderLinkId: orderLinkId,
        plannedQty: String(plan.qty),
        plannedMargin: String(plan.marginUsdt),
        leverageUsed,
        entryStrategy: opts.entryStrategy,
        limitPrice: opts.entryStrategy === "LIMIT_CHASE" ? String(opts.limitPrice ?? entryPrice) : null,
        limitExpiresAt,
        tpPrice: String(signal.takeProfit1),
        slPrice: String(signal.stopLoss),
        status: "PENDING_FILL",
        dryRun: false,
      })
      .returning({ id: trades.id });
    await db.update(signals).set({ tradeId: inserted[0].id }).where(eq(signals.id, signal.signalId));
    logger.info("Live order placed", {
      signalHash: signal.signalHash,
      bybitOrderId: order.orderId,
      qty: plan.qty,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await insertErrorTrade(signal, leverageUsed, message, false);
    logger.error("Executor failed", { signalHash: signal.signalHash, error: message });
  }
}

async function insertErrorTrade(
  signal: ExecutorSignal,
  leverageUsed: number,
  errorMessage: string,
  dryRun: boolean
): Promise<void> {
  await db.insert(trades).values({
    signalId: signal.signalId,
    symbol: signal.symbol,
    direction: signal.direction,
    bybitOrderLinkId: `copy-err-${signal.signalHash.slice(0, 10)}-${Date.now()}`,
    plannedQty: "0",
    plannedMargin: "0",
    leverageUsed,
    entryStrategy: "MARKET",
    tpPrice: String(signal.takeProfit1),
    slPrice: String(signal.stopLoss),
    status: "ERROR",
    errorMessage,
    dryRun,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dca/copy-trader test`
Expected: all tests pass (sizing + risk gate + executor + parser).

- [ ] **Step 5: Commit**

```bash
git add apps/copy-trader/src/executor.ts apps/copy-trader/src/executor.test.ts
git commit -m "feat(copy-trader): executor with dry-run + live branches"
```

---

## Task 9: BullMQ queue setup

**Files:**
- Create: `apps/copy-trader/src/queue.ts`

- [ ] **Step 1: Write the module**

Create `apps/copy-trader/src/queue.ts`:

```typescript
import { Queue, Worker, type Processor } from "bullmq";
import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on("error", (e) => logger.warn("Redis error", { error: e.message }));

const QUEUE_NAME = "copy-trader-watcher";

export const watcherQueue = new Queue(QUEUE_NAME, { connection });

export async function registerWatcherRepeatable(intervalMs = 30_000): Promise<void> {
  // Replace any existing repeatable definition so an interval change in code
  // takes effect on next boot.
  const repeatables = await watcherQueue.getRepeatableJobs();
  for (const r of repeatables) {
    await watcherQueue.removeRepeatableByKey(r.key);
  }
  await watcherQueue.add(
    "tick",
    {},
    { repeat: { every: intervalMs }, removeOnComplete: true, removeOnFail: 100 }
  );
  logger.info("Watcher repeatable registered", { intervalMs });
}

export function startWatcherWorker(processor: Processor): Worker {
  const worker = new Worker(QUEUE_NAME, processor, { connection, concurrency: 1 });
  worker.on("failed", (job, err) =>
    logger.error("Watcher job failed", { jobId: job?.id, error: err.message })
  );
  return worker;
}

export async function closeQueue(): Promise<void> {
  await watcherQueue.close();
  connection.disconnect();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/queue.ts
git commit -m "feat(copy-trader): BullMQ queue + worker setup for watcher"
```

---

## Task 10: Position watcher (reconciliation)

**Files:**
- Create: `apps/copy-trader/src/watcher.ts`

- [ ] **Step 1: Write the module**

Create `apps/copy-trader/src/watcher.ts`:

```typescript
import { db } from "./db/client.js";
import { trades, dailyStats, systemState } from "./db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  getOrderByLinkId,
  getPosition,
  getRecentExecutions,
  type BybitOrder,
  type BybitExecution,
} from "./bybit.js";
import { getConfigNumber } from "./configStore.js";
import { notifyLifecycle } from "./notifications.js";

const ACTIVE_STATUSES = ["PENDING_FILL", "OPEN"] as const;

export async function watcherTick(): Promise<void> {
  const open = await db
    .select()
    .from(trades)
    .where(and(eq(trades.dryRun, false), inArray(trades.status, ACTIVE_STATUSES as unknown as string[])));

  if (open.length === 0) return;

  for (const t of open) {
    try {
      await reconcileTrade(t);
    } catch (e) {
      logger.error("watcher: reconcile failed", {
        tradeId: t.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function reconcileTrade(t: typeof trades.$inferSelect): Promise<void> {
  const order = await getOrderByLinkId(t.bybitOrderLinkId);
  const position = await getPosition(t.symbol);

  // PENDING_FILL transitions
  if (t.status === "PENDING_FILL") {
    if (order && (order.orderStatus === "Filled" || order.orderStatus === "PartiallyFilled")) {
      await db
        .update(trades)
        .set({
          status: "OPEN",
          filledQty: order.cumExecQty,
          avgEntry: order.avgPrice,
          fillTs: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(trades.id, t.id));
      logger.info("Order filled", { tradeId: t.id, avgPrice: order.avgPrice });
      void notifyLifecycle(`filled ${t.symbol}`, `@ ${order.avgPrice}`);
      return;
    }
    if (order && (order.orderStatus === "Cancelled" || order.orderStatus === "Rejected")) {
      await db
        .update(trades)
        .set({ status: "NOT_FILLED", updatedAt: new Date() })
        .where(eq(trades.id, t.id));
      logger.info("Order cancelled before fill", { tradeId: t.id });
      void notifyLifecycle(`not filled ${t.symbol}`, order.orderStatus);
      return;
    }
    return; // still pending
  }

  // OPEN → closed?
  if (t.status === "OPEN") {
    if (position) return; // still open
    const closeInfo = await inferCloseInfo(t, order);
    await db
      .update(trades)
      .set({
        status: closeInfo.status,
        closeReason: closeInfo.reason,
        exitPrice: closeInfo.exitPrice,
        closeTs: new Date(),
        pnlUsdt: closeInfo.pnl,
        feesUsdt: closeInfo.fees,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, t.id));

    const pnl = Number(closeInfo.pnl ?? "0");
    await accumulateDailyStats(pnl);
    if (pnl < 0) {
      const cooldownMin = await getConfigNumber("COOLDOWN_MIN_AFTER_LOSS");
      const until = new Date(Date.now() + cooldownMin * 60_000);
      await db.update(systemState).set({
        cooldownUntil: until,
        cooldownReason: `Loss on ${t.symbol}`,
        updatedAt: new Date(),
      }).where(eq(systemState.id, 1));
    }

    logger.info("Trade closed", {
      tradeId: t.id,
      reason: closeInfo.reason,
      pnl,
    });
    void notifyLifecycle(
      `${closeInfo.status.toLowerCase()} ${t.symbol}`,
      `pnl ${pnl.toFixed(2)} USDT`
    );
  }
}

interface CloseInfo {
  status: "CLOSED_TP" | "CLOSED_SL" | "CLOSED_MANUAL" | "LIQUIDATED";
  reason: string;
  exitPrice: string | null;
  pnl: string | null;
  fees: string | null;
}

async function inferCloseInfo(
  t: typeof trades.$inferSelect,
  _order: BybitOrder | null
): Promise<CloseInfo> {
  const execs = await getRecentExecutions(t.symbol, 50);
  const closingExecs = execs.filter((e) => e.closedSize && Number(e.closedSize) > 0);
  if (closingExecs.length === 0) {
    return { status: "CLOSED_MANUAL", reason: "no closing executions found", exitPrice: null, pnl: null, fees: null };
  }
  const totalPnl = closingExecs.reduce((s, e) => s + Number(e.closedPnl), 0);
  const totalFees = closingExecs.reduce((s, e) => s + Number(e.execFee), 0);
  const avgPrice = closingExecs.reduce((s, e) => s + Number(e.execPrice) * Number(e.execQty), 0) /
    closingExecs.reduce((s, e) => s + Number(e.execQty), 0);

  const tp = Number(t.tpPrice);
  const sl = Number(t.slPrice);
  const tpDist = Math.abs(avgPrice - tp);
  const slDist = Math.abs(avgPrice - sl);
  const liqDetected = closingExecs.some((e) => e.execType?.toLowerCase().includes("liquidation"));

  let status: CloseInfo["status"] = "CLOSED_MANUAL";
  let reason = "manual close";
  if (liqDetected) {
    status = "LIQUIDATED";
    reason = "liquidation";
  } else if (tpDist < slDist && tpDist / tp < 0.005) {
    status = "CLOSED_TP";
    reason = "tp hit";
  } else if (slDist < tpDist && slDist / sl < 0.01) {
    status = "CLOSED_SL";
    reason = "sl hit";
  }

  return {
    status,
    reason,
    exitPrice: String(avgPrice),
    pnl: String(totalPnl),
    fees: String(totalFees),
  };
}

async function accumulateDailyStats(pnl: number): Promise<void> {
  const today = new Date();
  const day = today.toISOString().slice(0, 10);
  await db
    .insert(dailyStats)
    .values({
      day,
      tradesClosed: 1,
      pnlUsdt: String(pnl),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dailyStats.day,
      set: {
        tradesClosed: sql`${dailyStats.tradesClosed} + 1`,
        pnlUsdt: sql`${dailyStats.pnlUsdt} + ${String(pnl)}`,
        updatedAt: new Date(),
      },
    });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/watcher.ts
git commit -m "feat(copy-trader): position watcher reconciliation logic"
```

---

## Task 11: Wire executor into listener; boot sequence updates

**Files:**
- Modify: `apps/copy-trader/src/listener.ts`
- Modify: `apps/copy-trader/src/index.ts`

- [ ] **Step 1: Update listener to call executor on parse OK**

In `apps/copy-trader/src/listener.ts`, locate the block inside `ingestSignalText` where status `PARSED` is logged after `notifySignalParsed`. After the `void notifySignalParsed({...})` call, add a `void` call to a new helper `executeWithGate(i, inserted[0].id)` and define that helper below.

Add this new helper at the bottom of the file, above the closing `}` of the module:

```typescript
import { evaluateRiskGate, type GateContext } from "./riskGate.js";
import { executeSignal } from "./executor.js";
import { getLastPrice, getWalletBalanceUsdt } from "./bybit.js";
import { getConfigNumber, getConfigBool, getConfigCsv } from "./configStore.js";
import { db as gateDb } from "./db/client.js";
import { trades as tradesTable, systemState as ssTable } from "./db/schema.js";
import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import type { SignalIntent } from "./parser.js";

async function executeWithGate(intent: SignalIntent, signalId: string): Promise<void> {
  try {
    const [
      maxOpen,
      dailyLossPct,
      maxDrawdownPct,
      chaseTolerancePct,
      minRrRatio,
      maxRiskPct,
      maxLeverage,
      chaseTimeoutMin,
      dryRun,
      whitelist,
    ] = await Promise.all([
      getConfigNumber("MAX_OPEN_POSITIONS"),
      getConfigNumber("DAILY_LOSS_LIMIT_PCT"),
      getConfigNumber("MAX_DRAWDOWN_PCT"),
      getConfigNumber("CHASE_TOLERANCE_PCT"),
      getConfigNumber("MIN_RR_RATIO"),
      getConfigNumber("MAX_RISK_PCT"),
      getConfigNumber("MAX_LEVERAGE"),
      getConfigNumber("CHASE_TIMEOUT_MIN"),
      getConfigBool("DRY_RUN"),
      getConfigCsv("WHITELIST_SYMBOLS"),
    ]);

    const stateRows = await gateDb.select().from(ssTable).where(eq(ssTable.id, 1)).limit(1);
    const state = stateRows[0];
    if (!state) {
      logger.warn("system_state row missing, skipping execute");
      return;
    }

    const openCountRows = await gateDb
      .select({ c: drizzleSql<number>`count(*)::int` })
      .from(tradesTable)
      .where(and(eq(tradesTable.dryRun, false), inArray(tradesTable.status, ["PENDING_FILL", "OPEN"])));
    const openCount = openCountRows[0]?.c ?? 0;

    const balance = state.initialCapital ? await getWalletBalanceUsdt() : Number(state.initialCapital ?? 0);
    const balanceUsdt = config.BYBIT_API_KEY ? await getWalletBalanceUsdt() : Number(state.initialCapital ?? 0);
    const initialCapital = Number(state.initialCapital ?? 0);

    const lastPrice = config.BYBIT_API_KEY ? await getLastPrice(intent.symbol) : (intent.entryLow + intent.entryHigh) / 2;

    const gateCtx: GateContext = {
      config: {
        MAX_OPEN_POSITIONS: maxOpen,
        DAILY_LOSS_LIMIT_PCT: dailyLossPct,
        MAX_DRAWDOWN_PCT: maxDrawdownPct,
        CHASE_TOLERANCE_PCT: chaseTolerancePct,
        MIN_RR_RATIO: minRrRatio,
        WHITELIST_SYMBOLS: whitelist,
      },
      state: {
        killed: state.killed,
        killedReason: state.killedReason,
        cooldownUntil: state.cooldownUntil,
        initialCapital,
      },
      balance: balanceUsdt,
      openCount,
      dayPnl: 0,
      dayBalanceStart: initialCapital,
      lastPrice,
      now: new Date(),
    };

    const gate = evaluateRiskGate(
      {
        signalHash: intent.signalHash,
        direction: intent.direction,
        symbol: intent.symbol,
        entryLow: intent.entryLow,
        entryHigh: intent.entryHigh,
        stopLoss: intent.stopLoss,
        takeProfit1: intent.takeProfit1,
        leverageRaw: intent.leverageRaw,
      },
      gateCtx
    );

    if (!gate.ok) {
      logger.info("Gate rejected", { signalHash: intent.signalHash, reason: gate.reason });
      return;
    }

    await executeSignal(
      {
        signalId,
        signalHash: intent.signalHash,
        direction: intent.direction,
        symbol: intent.symbol,
        entryLow: intent.entryLow,
        entryHigh: intent.entryHigh,
        stopLoss: intent.stopLoss,
        takeProfit1: intent.takeProfit1,
        leverageRaw: intent.leverageRaw,
      },
      {
        dryRun,
        maxLeverage,
        maxRiskPct,
        balanceUsdt,
        lastPrice,
        entryStrategy: gate.entryStrategy,
        limitPrice: gate.limitPrice,
        chaseTimeoutMin,
      }
    );
  } catch (e) {
    logger.error("executeWithGate threw", {
      signalHash: intent.signalHash,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
```

In the PARSED branch of `ingestSignalText`, immediately after `void notifySignalParsed({...})`, add:

```typescript
      void executeWithGate(i, inserted[0].id);
```

- [ ] **Step 2: Update boot sequence**

Edit `apps/copy-trader/src/index.ts` so it seeds defaults, initializes system_state.initial_capital, starts the watcher, and gracefully shuts down BullMQ. Replace its contents with:

```typescript
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runMigrations } from "./db/migrate.js";
import { initNotifier, verifyChat, notifyLifecycle } from "./notifications.js";
import { startListener, stopListener } from "./listener.js";
import { reconcileRecentMessages } from "./recovery.js";
import { startServer } from "./server.js";
import { db } from "./db/client.js";
import { systemState } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { seedDefaults } from "./configStore.js";
import { registerWatcherRepeatable, startWatcherWorker, closeQueue } from "./queue.js";
import { watcherTick } from "./watcher.js";
import { getWalletBalanceUsdt } from "./bybit.js";

async function ensureSystemStateRow(): Promise<void> {
  const existing = await db.select().from(systemState).where(eq(systemState.id, 1)).limit(1);
  if (existing.length === 0) {
    await db.insert(systemState).values({ id: 1 });
    logger.info("system_state row created");
  }
}

async function bootstrapInitialCapital(): Promise<void> {
  const rows = await db.select().from(systemState).where(eq(systemState.id, 1));
  if (rows[0]?.initialCapital) return;
  let capital = config.INITIAL_CAPITAL_USDT_OVERRIDE;
  if (capital === 0 && config.BYBIT_API_KEY) {
    try {
      capital = await getWalletBalanceUsdt();
    } catch (e) {
      logger.warn("Could not read Bybit balance for initial capital", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (capital > 0) {
    await db
      .update(systemState)
      .set({ initialCapital: String(capital), updatedAt: new Date() })
      .where(eq(systemState.id, 1));
    logger.info("system_state.initial_capital populated", { capital });
  }
}

async function main() {
  logger.info("Boot starting", { nodeEnv: config.NODE_ENV });

  await runMigrations();
  await ensureSystemStateRow();
  await seedDefaults();
  await bootstrapInitialCapital();

  initNotifier();
  await verifyChat();

  const client = await startListener();
  await reconcileRecentMessages(client);

  await registerWatcherRepeatable(30_000);
  const watcherWorker = startWatcherWorker(async () => {
    await watcherTick();
  });

  const app = await startServer();
  await notifyLifecycle("started");

  const shutdown = async (signal: string) => {
    logger.info("Shutdown signal", { signal });
    try {
      await app.close();
      await stopListener();
      await watcherWorker.close();
      await closeQueue();
      await notifyLifecycle("stopped", `signal=${signal}`);
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  logger.error("Fatal boot error", {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    await notifyLifecycle("crashed", error instanceof Error ? error.message : String(error));
  } catch {
    // best effort
  }
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @dca/copy-trader typecheck`
Run: `pnpm --filter @dca/copy-trader test`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add apps/copy-trader/src/listener.ts apps/copy-trader/src/index.ts
git commit -m "feat(copy-trader): wire executor into listener + watcher into boot"
```

---

## Task 12: Server endpoints for trades / stats / system-state / config

**Files:**
- Modify: `apps/copy-trader/src/server.ts`

- [ ] **Step 1: Add new endpoints**

Open `apps/copy-trader/src/server.ts`. After the existing `/api/copy/signals` route, add:

```typescript
  app.get(
    "/api/copy/trades",
    { preHandler: authPreHandler },
    async (req) => {
      const q = req.query as { page?: string; pageSize?: string; status?: string; includeDryRun?: string };
      const page = Math.max(1, Number(q.page ?? "1"));
      const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? "50")));
      const offset = (page - 1) * pageSize;
      const conditions: import("drizzle-orm").SQL[] = [];
      if (q.status) conditions.push(eq(trades.status, q.status));
      if (q.includeDryRun !== "true") conditions.push(eq(trades.dryRun, false));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(trades)
        .where(where)
        .orderBy(desc(trades.createdAt))
        .limit(pageSize)
        .offset(offset);
      const total = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(trades)
        .where(where);

      return {
        page,
        pageSize,
        total: total[0]?.count ?? 0,
        items: rows.map((r) => ({
          id: r.id,
          signalId: r.signalId,
          symbol: r.symbol,
          direction: r.direction,
          bybitOrderId: r.bybitOrderId,
          bybitOrderLinkId: r.bybitOrderLinkId,
          plannedQty: r.plannedQty,
          plannedMargin: r.plannedMargin,
          leverageUsed: r.leverageUsed,
          entryStrategy: r.entryStrategy,
          limitPrice: r.limitPrice,
          limitExpiresAt: r.limitExpiresAt?.toISOString() ?? null,
          filledQty: r.filledQty,
          avgEntry: r.avgEntry,
          fillTs: r.fillTs?.toISOString() ?? null,
          tpPrice: r.tpPrice,
          slPrice: r.slPrice,
          status: r.status,
          closeReason: r.closeReason,
          exitPrice: r.exitPrice,
          closeTs: r.closeTs?.toISOString() ?? null,
          pnlUsdt: r.pnlUsdt,
          feesUsdt: r.feesUsdt,
          errorMessage: r.errorMessage,
          dryRun: r.dryRun,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }
  );

  app.get("/api/copy/stats", { preHandler: authPreHandler }, async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRows = await db
      .select()
      .from(dailyStats)
      .where(eq(dailyStats.day, todayStr))
      .limit(1);
    const last7 = await db
      .select({
        pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
        closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
      })
      .from(dailyStats)
      .where(sql`${dailyStats.day} > current_date - INTERVAL '7 days'`);
    const allTime = await db
      .select({
        pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
        closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
      })
      .from(dailyStats);
    const wins = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(eq(trades.dryRun, false), inArray(trades.status, ["CLOSED_TP"])));
    const losses = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(eq(trades.dryRun, false), inArray(trades.status, ["CLOSED_SL", "LIQUIDATED"])));

    return {
      today: {
        pnlUsdt: Number(todayRows[0]?.pnlUsdt ?? 0),
        tradesClosed: todayRows[0]?.tradesClosed ?? 0,
      },
      last7: { pnlUsdt: last7[0]?.pnl ?? 0, tradesClosed: last7[0]?.closed ?? 0 },
      allTime: { pnlUsdt: allTime[0]?.pnl ?? 0, tradesClosed: allTime[0]?.closed ?? 0 },
      wins: wins[0]?.c ?? 0,
      losses: losses[0]?.c ?? 0,
    };
  });

  app.get("/api/copy/system-state", { preHandler: authPreHandler }, async () => {
    const rows = await db.select().from(systemState).where(eq(systemState.id, 1)).limit(1);
    const s = rows[0];
    return {
      killed: s?.killed ?? false,
      killedReason: s?.killedReason ?? null,
      killedAt: s?.killedAt?.toISOString() ?? null,
      cooldownUntil: s?.cooldownUntil?.toISOString() ?? null,
      cooldownReason: s?.cooldownReason ?? null,
      initialCapital: s?.initialCapital ?? null,
    };
  });

  app.get("/api/copy/config", { preHandler: authPreHandler }, async () => {
    return await getAllConfig();
  });

  app.put<{ Params: { key: string }; Body: { value: string } }>(
    "/api/copy/config/:key",
    { preHandler: authPreHandler },
    async (req, reply) => {
      const { key } = req.params;
      const value = req.body?.value;
      if (typeof value !== "string") {
        reply.code(400);
        return { error: "value must be a string" };
      }
      try {
        await setConfig(key, value);
        return { ok: true };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
  );

  app.post(
    "/api/copy/admin/reset-kill-switch",
    { preHandler: authPreHandler },
    async () => {
      await db
        .update(systemState)
        .set({ killed: false, killedReason: null, killedAt: null, updatedAt: new Date() })
        .where(eq(systemState.id, 1));
      return { ok: true };
    }
  );

  app.post(
    "/api/copy/admin/kill",
    { preHandler: authPreHandler },
    async (req) => {
      const reason = (req.body as { reason?: string } | undefined)?.reason ?? "manual";
      await db
        .update(systemState)
        .set({ killed: true, killedReason: reason, killedAt: new Date(), updatedAt: new Date() })
        .where(eq(systemState.id, 1));
      return { ok: true };
    }
  );
```

You'll need to extend the imports at the top of the file to cover the new tables/utilities. Replace the top imports with:

```typescript
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import type { CopySignalsPage } from "@dca/shared";
import { db, sql as pg } from "./db/client.js";
import { signals, trades, dailyStats, systemState } from "./db/schema.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getAllConfig, setConfig } from "./configStore.js";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @dca/copy-trader typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/copy-trader/src/server.ts
git commit -m "feat(copy-trader): server endpoints for trades, stats, system-state, config"
```

---

## Task 13: Shared API types

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Append new types**

Open `packages/shared/src/index.ts`. Append at the bottom (after `CopySignalsPage`):

```typescript
export type CopyTradeStatus =
  | "DRY_RUN_LOGGED"
  | "PENDING_FILL"
  | "OPEN"
  | "NOT_FILLED"
  | "CLOSED_TP"
  | "CLOSED_SL"
  | "CLOSED_MANUAL"
  | "LIQUIDATED"
  | "ERROR";

export interface CopyTrade {
  id: string;
  signalId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  bybitOrderId: string | null;
  bybitOrderLinkId: string;
  plannedQty: string;
  plannedMargin: string;
  leverageUsed: number;
  entryStrategy: "MARKET" | "LIMIT_CHASE";
  limitPrice: string | null;
  limitExpiresAt: string | null;
  filledQty: string | null;
  avgEntry: string | null;
  fillTs: string | null;
  tpPrice: string;
  slPrice: string;
  status: CopyTradeStatus;
  closeReason: string | null;
  exitPrice: string | null;
  closeTs: string | null;
  pnlUsdt: string | null;
  feesUsdt: string | null;
  errorMessage: string | null;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CopyTradesPage {
  page: number;
  pageSize: number;
  total: number;
  items: CopyTrade[];
}

export interface CopyStatsBucket {
  pnlUsdt: number;
  tradesClosed: number;
}

export interface CopyStats {
  today: CopyStatsBucket;
  last7: CopyStatsBucket;
  allTime: CopyStatsBucket;
  wins: number;
  losses: number;
}

export interface CopySystemState {
  killed: boolean;
  killedReason: string | null;
  killedAt: string | null;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  initialCapital: string | null;
}

export type CopyConfig = Record<string, string>;
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @dca/shared build`
Expected: dist updated.

- [ ] **Step 3: Re-export from web lib**

Open `apps/web/src/lib/api.ts`. Extend the re-export block:

```typescript
export type {
  CopySignal,
  CopySignalsPage,
  CopySignalStatus,
  CopyTrade,
  CopyTradesPage,
  CopyTradeStatus,
  CopyStats,
  CopySystemState,
  CopyConfig,
} from "@dca/shared";
```

- [ ] **Step 4: Typecheck both**

Run: `pnpm --filter @dca/shared typecheck`
Run: `pnpm --filter @dca/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/web/src/lib/api.ts
git commit -m "feat(shared): F1 wire types (trades, stats, system-state, config)"
```

---

## Task 14: Dashboard — TradesTable

**Files:**
- Create: `apps/web/src/components/copy/TradesTable.tsx`
- Modify: `apps/web/src/pages/CopyTraderPage.tsx`

- [ ] **Step 1: Create TradesTable**

Create `apps/web/src/components/copy/TradesTable.tsx`:

```typescript
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { CopyTradesPage } from "../../lib/api.ts";

function useCopyTrades(page: number, status: string, includeDryRun: boolean) {
  return useQuery<CopyTradesPage>({
    queryKey: ["copy-trades", page, status, includeDryRun],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (status) params.set("status", status);
      params.set("includeDryRun", String(includeDryRun));
      const res = await fetch(`/api/copy/trades?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load trades (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function TradesTable() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [includeDryRun, setIncludeDryRun] = useState(true);
  const { data, isLoading, error } = useCopyTrades(page, status, includeDryRun);

  if (isLoading && !data) return <div className="p-4 text-surface-400">Loading…</div>;
  if (error) return <div className="p-4 text-red-loss">Error: {String(error)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-surface-400">Status:</label>
        <select
          className="rounded bg-surface-800 px-2 py-1 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="DRY_RUN_LOGGED">Dry-run logged</option>
          <option value="PENDING_FILL">Pending fill</option>
          <option value="OPEN">Open</option>
          <option value="NOT_FILLED">Not filled</option>
          <option value="CLOSED_TP">Closed TP</option>
          <option value="CLOSED_SL">Closed SL</option>
          <option value="CLOSED_MANUAL">Closed manual</option>
          <option value="LIQUIDATED">Liquidated</option>
          <option value="ERROR">Error</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-surface-400">
          <input
            type="checkbox"
            checked={includeDryRun}
            onChange={(e) => setIncludeDryRun(e.target.checked)}
          />
          Include dry-run
        </label>
        <span className="ml-auto text-xs text-surface-500">{data.total} total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm font-mono">
          <thead className="text-xs uppercase text-surface-400">
            <tr>
              <th className="px-2 py-2 text-left">Created</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-left">Symbol</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Margin</th>
              <th className="px-2 py-2 text-right">Lev</th>
              <th className="px-2 py-2 text-right">Avg Entry</th>
              <th className="px-2 py-2 text-right">Exit</th>
              <th className="px-2 py-2 text-right">PnL</th>
              <th className="px-2 py-2 text-left">Dry?</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id} className="border-t border-surface-800">
                <td className="px-2 py-1 whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1">{t.status}</td>
                <td className="px-2 py-1">{t.direction}</td>
                <td className="px-2 py-1">{t.symbol}</td>
                <td className="px-2 py-1 text-right">{t.plannedQty}</td>
                <td className="px-2 py-1 text-right">{t.plannedMargin}</td>
                <td className="px-2 py-1 text-right">{t.leverageUsed}x</td>
                <td className="px-2 py-1 text-right">{t.avgEntry ?? "—"}</td>
                <td className="px-2 py-1 text-right">{t.exitPrice ?? "—"}</td>
                <td className={`px-2 py-1 text-right ${Number(t.pnlUsdt ?? 0) > 0 ? "text-green-gain" : Number(t.pnlUsdt ?? 0) < 0 ? "text-red-loss" : ""}`}>
                  {t.pnlUsdt ?? "—"}
                </td>
                <td className="px-2 py-1 text-amber-glow">{t.dryRun ? "DRY" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="text-xs text-surface-500">
          Page {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
        </span>
        <button
          className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
          onClick={() => setPage((p) => p + 1)}
          disabled={page * data.pageSize >= data.total}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render TradesTable on the copy page**

Open `apps/web/src/pages/CopyTraderPage.tsx`. Replace its body with:

```typescript
import { SignalsTable } from "../components/copy/SignalsTable.tsx";
import { TradesTable } from "../components/copy/TradesTable.tsx";

export function CopyTraderPage() {
  return (
    <div className="space-y-8 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Copy Trader</h1>
        <p className="text-sm text-surface-400">
          Live ingestion + dry-run executor for Mack signals.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Trades</h2>
        <TradesTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Signals</h2>
        <SignalsTable />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter @dca/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/copy/TradesTable.tsx apps/web/src/pages/CopyTraderPage.tsx
git commit -m "feat(web): TradesTable + render on copy page"
```

---

## Task 15: Dashboard — StatsCard

**Files:**
- Create: `apps/web/src/components/copy/StatsCard.tsx`
- Modify: `apps/web/src/pages/CopyTraderPage.tsx`

- [ ] **Step 1: Create StatsCard**

Create `apps/web/src/components/copy/StatsCard.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import type { CopyStats } from "../../lib/api.ts";

function useCopyStats() {
  return useQuery<CopyStats>({
    queryKey: ["copy-stats"],
    queryFn: async () => {
      const res = await fetch("/api/copy/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} USDT`;
}

function pnlTone(n: number): string {
  if (n > 0) return "text-green-gain";
  if (n < 0) return "text-red-loss";
  return "text-surface-300";
}

export function StatsCard() {
  const { data, isLoading, error } = useCopyStats();
  if (isLoading) return <div className="rounded-lg bg-surface-800/40 p-4 text-surface-400">Loading stats…</div>;
  if (error || !data) return null;
  const winRate = data.wins + data.losses === 0 ? 0 : (data.wins / (data.wins + data.losses)) * 100;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Today" value={fmtUsd(data.today.pnlUsdt)} tone={pnlTone(data.today.pnlUsdt)} />
      <Stat label="7d" value={fmtUsd(data.last7.pnlUsdt)} tone={pnlTone(data.last7.pnlUsdt)} />
      <Stat label="All-time" value={fmtUsd(data.allTime.pnlUsdt)} tone={pnlTone(data.allTime.pnlUsdt)} />
      <Stat label="Win rate" value={`${winRate.toFixed(0)}% (${data.wins}/${data.wins + data.losses})`} tone="text-surface-200" />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-surface-800 bg-surface-800/40 p-3">
      <div className="text-xs uppercase text-surface-400">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add to page**

Open `apps/web/src/pages/CopyTraderPage.tsx`. Above the existing Trades section, insert:

```typescript
      <section>
        <StatsCard />
      </section>
```

And add the import: `import { StatsCard } from "../components/copy/StatsCard.tsx";`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @dca/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/copy/StatsCard.tsx apps/web/src/pages/CopyTraderPage.tsx
git commit -m "feat(web): StatsCard (today / 7d / all-time / win rate)"
```

---

## Task 16: Dashboard — SystemStatePanel + ConfigForm

**Files:**
- Create: `apps/web/src/components/copy/SystemStatePanel.tsx`
- Create: `apps/web/src/components/copy/ConfigForm.tsx`
- Modify: `apps/web/src/pages/CopyTraderPage.tsx`

- [ ] **Step 1: Create SystemStatePanel**

Create `apps/web/src/components/copy/SystemStatePanel.tsx`:

```typescript
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CopySystemState } from "../../lib/api.ts";

function useSystemState() {
  return useQuery<CopySystemState>({
    queryKey: ["copy-system-state"],
    queryFn: async () => {
      const res = await fetch("/api/copy/system-state", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load system state (${res.status})`);
      return res.json();
    },
    refetchInterval: 10_000,
  });
}

export function SystemStatePanel() {
  const qc = useQueryClient();
  const { data } = useSystemState();
  if (!data) return null;

  const reset = async () => {
    if (!confirm("Re-enable bot? This clears the kill switch.")) return;
    await fetch("/api/copy/admin/reset-kill-switch", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["copy-system-state"] });
  };
  const kill = async () => {
    const reason = prompt("Manual kill reason:") ?? "manual";
    await fetch("/api/copy/admin/kill", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    qc.invalidateQueries({ queryKey: ["copy-system-state"] });
  };

  return (
    <div className={`rounded-lg border p-4 ${data.killed ? "border-red-loss/40 bg-red-loss/5" : "border-surface-800 bg-surface-800/40"}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-surface-400">System</div>
          <div className="mt-1 font-mono text-base">
            {data.killed ? <span className="text-red-loss">KILLED — {data.killedReason}</span> : <span className="text-green-gain">ARMED</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {data.killed ? (
            <button onClick={reset} className="rounded bg-green-gain/20 px-3 py-1 text-xs text-green-gain hover:bg-green-gain/30">
              Reset kill switch
            </button>
          ) : (
            <button onClick={kill} className="rounded bg-red-loss/20 px-3 py-1 text-xs text-red-loss hover:bg-red-loss/30">
              Kill now
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-surface-300 md:grid-cols-4">
        <div>
          <div className="text-surface-500">Initial capital</div>
          <div className="font-mono">{data.initialCapital ?? "—"} USDT</div>
        </div>
        <div>
          <div className="text-surface-500">Cooldown until</div>
          <div className="font-mono">{data.cooldownUntil ? new Date(data.cooldownUntil).toLocaleString() : "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">Cooldown reason</div>
          <div className="font-mono">{data.cooldownReason ?? "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">Killed at</div>
          <div className="font-mono">{data.killedAt ? new Date(data.killedAt).toLocaleString() : "—"}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ConfigForm**

Create `apps/web/src/components/copy/ConfigForm.tsx`:

```typescript
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CopyConfig } from "../../lib/api.ts";

function useConfig() {
  return useQuery<CopyConfig>({
    queryKey: ["copy-config"],
    queryFn: async () => {
      const res = await fetch("/api/copy/config", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
      return res.json();
    },
  });
}

const KEY_LABEL: Record<string, string> = {
  MAX_RISK_PCT: "Max risk %",
  MAX_LEVERAGE: "Max leverage",
  MAX_OPEN_POSITIONS: "Max open positions",
  DAILY_LOSS_LIMIT_PCT: "Daily loss limit %",
  MAX_DRAWDOWN_PCT: "Max drawdown %",
  COOLDOWN_MIN_AFTER_LOSS: "Cooldown (min)",
  CHASE_TOLERANCE_PCT: "Chase tolerance %",
  CHASE_TIMEOUT_MIN: "Chase timeout (min)",
  MIN_RR_RATIO: "Min R:R",
  WHITELIST_SYMBOLS: "Whitelist (CSV)",
  DRY_RUN: "Dry run",
};

export function ConfigForm() {
  const qc = useQueryClient();
  const { data } = useConfig();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!data) return null;
  const keys = Object.keys(KEY_LABEL);

  async function save(key: string, value: string) {
    const res = await fetch(`/api/copy/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [key]: body.error ?? `HTTP ${res.status}` }));
      return;
    }
    setErrors((e) => ({ ...e, [key]: "" }));
    setDrafts((d) => ({ ...d, [key]: "" }));
    qc.invalidateQueries({ queryKey: ["copy-config"] });
  }

  return (
    <div className="rounded-lg border border-surface-800 bg-surface-800/40 p-4">
      <div className="mb-3 text-xs uppercase text-surface-400">Config</div>
      <div className="space-y-2">
        {keys.map((k) => {
          const current = data[k] ?? "";
          const draft = drafts[k];
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <label className="w-48 text-surface-300">{KEY_LABEL[k]}</label>
              <input
                className="rounded bg-surface-900 px-2 py-1 font-mono text-xs text-surface-100"
                value={draft ?? current}
                onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
              />
              <button
                onClick={() => save(k, draft ?? current)}
                disabled={draft == null || draft === current}
                className="rounded bg-amber-glow/20 px-2 py-1 text-xs text-amber-glow disabled:opacity-40"
              >
                Save
              </button>
              {errors[k] && <span className="text-xs text-red-loss">{errors[k]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add to page**

Open `apps/web/src/pages/CopyTraderPage.tsx`. Add imports for both:

```typescript
import { SystemStatePanel } from "../components/copy/SystemStatePanel.tsx";
import { ConfigForm } from "../components/copy/ConfigForm.tsx";
```

Insert sections, replacing the page body so it renders all four blocks in order:

```typescript
    <div className="space-y-8 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Copy Trader</h1>
        <p className="text-sm text-surface-400">
          Live ingestion + dry-run executor for Mack signals.
        </p>
      </header>

      <SystemStatePanel />

      <StatsCard />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Trades</h2>
        <TradesTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Signals</h2>
        <SignalsTable />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-surface-400">Config</h2>
        <ConfigForm />
      </section>
    </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @dca/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/copy/SystemStatePanel.tsx apps/web/src/components/copy/ConfigForm.tsx apps/web/src/pages/CopyTraderPage.tsx
git commit -m "feat(web): SystemStatePanel + ConfigForm on Copy Trader page"
```

---

## Task 17: Compose env passthrough + .env.example

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `.env.example`

- [ ] **Step 1: Pass Bybit env to copy-trader service**

Open `docker-compose.yml`. Inside the `copy-trader:` service's `environment:` block, just before `healthcheck:`, append:

```yaml
      REDIS_URL: redis://redis:6379
      BYBIT_API_KEY: ${COPY_BYBIT_API_KEY:-}
      BYBIT_API_SECRET: ${COPY_BYBIT_API_SECRET:-}
      BYBIT_TESTNET: ${COPY_BYBIT_TESTNET:-false}
      INITIAL_CAPITAL_USDT_OVERRIDE: ${COPY_INITIAL_CAPITAL_USDT_OVERRIDE:-0}
```

Also add `redis` to `depends_on`:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

- [ ] **Step 2: Mirror into docker-compose.dev.yml**

Same additions in the dev compose file, with `BYBIT_TESTNET: "true"` as the dev default.

- [ ] **Step 3: Extend .env.example**

Append:

```bash
# ---- Copy Trader F1 (Bybit) ----
COPY_BYBIT_API_KEY=
COPY_BYBIT_API_SECRET=
COPY_BYBIT_TESTNET=false
COPY_INITIAL_CAPITAL_USDT_OVERRIDE=
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml .env.example
git commit -m "feat(infra): pass Bybit + Redis env to copy-trader; depend on redis"
```

---

## Task 18: Documentation update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append an F1 row block to the copy-trader "Where things live" table**

Open `CLAUDE.md`. In the `## Where things live — apps/copy-trader (F0)` section, rename the heading to drop the `(F0)` tag (now F1) and add new rows below the existing ones:

```markdown
| Bybit V5 client | `apps/copy-trader/src/bybit.ts` |
| Instrument info cache | `apps/copy-trader/src/instrumentInfo.ts` |
| Sizing math | `apps/copy-trader/src/sizing.ts` + `sizing.test.ts` |
| Config store (runtime) | `apps/copy-trader/src/configStore.ts` |
| Risk gate (8 guardrails) | `apps/copy-trader/src/riskGate.ts` + `riskGate.test.ts` |
| Executor (dry-run + live) | `apps/copy-trader/src/executor.ts` + `executor.test.ts` |
| BullMQ queue + worker | `apps/copy-trader/src/queue.ts` |
| Position watcher | `apps/copy-trader/src/watcher.ts` |
```

Replace the existing "F0 scope" paragraph with:

```markdown
**F1 scope:** listener + parser + risk gate + dry-run executor + position watcher.
Default `DRY_RUN=true` — every triggered signal is fully *planned* and persisted to
`copy_trader.trades` (status=`DRY_RUN_LOGGED`) but no live order hits Bybit. Flip
`DRY_RUN=false` in the config table via dashboard to go live (only do this after
the F2 plan has been reviewed). The watcher BullMQ job polls Bybit every 30 s for
trades with `dry_run=false` AND status in (PENDING_FILL, OPEN) to reconcile fills,
closes, fees, and PnL.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(copy-trader): document F1 modules and dry-run scope"
```

---

## Task 19: Manual operator runbook (DEPLOY_F1.md)

**Files:**
- Create: `DEPLOY_F1.md` (committed; operator-facing)

- [ ] **Step 1: Write the runbook**

Create `DEPLOY_F1.md`:

```markdown
# Copy-Trader F1 — Deployment Runbook

## Prerequisites (do these BEFORE flipping DRY_RUN=false)

1. **Create a Bybit sub-account** in your existing Bybit org.
   - Bybit web → Settings → Sub-Accounts → Create
   - Type: **Unified Trading**
   - Name it something obvious (e.g. `copy-trader-mack`)

2. **Generate an API key under the sub-account** with:
   - Permissions: **Derivatives → Read & Trade** ONLY
   - **Disable** Withdrawal and Spot trading
   - IP restriction: optional but recommended (use the Dokploy VPS IP `69.62.100.241`)
   - Save the key/secret somewhere safe.

3. **Fund the sub-account** with ~50 USDT (Bybit web → Transfer → Funding → sub-account).

4. **Set env vars in Dokploy** (project `dca-crypto-bot` → service `app` → Environment):
   - `COPY_BYBIT_API_KEY=<your key>`
   - `COPY_BYBIT_API_SECRET=<your secret>`
   - `COPY_BYBIT_TESTNET=false`
   - `COPY_INITIAL_CAPITAL_USDT_OVERRIDE=` (leave empty — the bot reads the actual balance on first boot)

5. Trigger a redeploy in Dokploy. Watch the logs (`docker logs copy-trader …`) for `Bybit client initialized` and `system_state.initial_capital populated`.

## First-trade walkthrough (still DRY_RUN)

When Mack posts a signal in topic 4:

- Listener parses → inserts `signals` row.
- Executor calls riskGate → if pass, computes plan → inserts `trades` row with `status=DRY_RUN_LOGGED, dry_run=true`.
- Telegram notify fires with the parsed signal summary.
- Dashboard → Copy Trader tab → **Trades** section shows the dry-run row with `DRY` tag.

Inspect the row: `plannedQty`, `plannedMargin`, `leverageUsed`, `tpPrice`, `slPrice`. Sanity-check by hand:

- Risk USDT = balance × MAX_RISK_PCT
- SL distance % = |entry − SL| / entry
- Position USDT = risk / SL distance %
- Qty = position USDT / entry, floored to qtyStep
- Margin = position USDT / leverage_used

These should match the row.

## Going live (F2 territory — separate plan)

Don't flip DRY_RUN here. F2 is a separate plan that adds:
- Kill-switch arming verification
- Initial-capital lock-in confirmation
- First-live-trade observability checks
- Rollback procedure

## Troubleshooting

| Symptom | First check |
|---------|-------------|
| Watcher silent | `docker logs copy-trader` for `Watcher job failed` |
| `Bybit API key/secret not configured` | Env vars not set in Dokploy |
| `Bybit 110007: …` | Insufficient balance — fund the sub-account |
| `Bybit 110045: …` | Cannot set leverage — symbol may be in margin-mode mismatch |
| Trade stuck in `PENDING_FILL` | Order may have cancelled silently — check Bybit UI |
| Trade stuck in `OPEN` after Bybit position closed | Watcher's `inferCloseInfo` heuristic missed — check `copy_trader.trades.exit_price` vs `tp_price`/`sl_price` |
```

- [ ] **Step 2: Commit**

```bash
git add DEPLOY_F1.md
git commit -m "docs(copy-trader): F1 deployment runbook"
```

---

## Task 20: End-to-end local smoke (manual)

**Files:** none

- [ ] **Step 1: Local stack up**

Run: `docker compose -f docker-compose.dev.yml --env-file .env up -d`
Wait for postgres + redis healthy.

- [ ] **Step 2: Migrations**

Run: `cd apps/copy-trader && DATABASE_URL=postgres://dca:devpass@localhost:5432/dca_bot pnpm db:migrate`
Expected: `Migrations complete`.

- [ ] **Step 3: Run service locally**

Run: `cd apps/copy-trader && pnpm dev`
Expected boot lines:

- `Migrations complete`
- `Seeded config defaults` (first run only)
- `system_state row created` (first run only)
- `system_state.initial_capital populated` (skipped if BYBIT_API_KEY unset — that's fine)
- `Telegram listener connected`
- `Watcher repeatable registered`
- `HTTP server listening`

- [ ] **Step 4: Verify config seeded**

In another shell:

```bash
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U dca -d dca_bot -c 'SELECT key, value FROM copy_trader.config ORDER BY key'
```

Expected: 11 rows matching `CONFIG_DEFAULTS`.

- [ ] **Step 5: Trigger a synthetic PARSED row**

Easiest: post a real signal-shaped message in topic 4 from your test account, OR manually insert a row to exercise the executor:

```sql
INSERT INTO copy_trader.signals
  (signal_hash, raw_text, telegram_msg_id, telegram_sender_id, direction, symbol,
   entry_low, entry_high, stop_loss, leverage_raw, take_profit_1, status)
VALUES
  ('synthetic-1', 'SHORT BTC test', 999999, 6492923280, 'SHORT', 'BTCUSDT',
   79400, 79900, 83000, 15, 76400, 'PARSED');
```

This won't trigger `executeWithGate` because the trigger is `listener.ts`, not a DB insert. To test the executor path locally, send a real test message to the channel as Mack (or via the same SignalIntent shape) — or write a one-off `tsx` script that imports `executeWithGate` from listener and calls it.

- [ ] **Step 6: Confirm dry-run trade landed**

```bash
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U dca -d dca_bot -c "SELECT status, dry_run, planned_qty, leverage_used FROM copy_trader.trades ORDER BY created_at DESC LIMIT 5"
```

Expected: at least one row with `status='DRY_RUN_LOGGED'`, `dry_run=true`.

- [ ] **Step 7: Hit the API**

```bash
curl -H "Cookie: token=<jwt>" http://localhost:3001/api/copy/trades?pageSize=10
curl -H "Cookie: token=<jwt>" http://localhost:3001/api/copy/stats
curl -H "Cookie: token=<jwt>" http://localhost:3001/api/copy/system-state
curl -H "Cookie: token=<jwt>" http://localhost:3001/api/copy/config
```

Expected: each returns JSON shaped to the matching shared type.

- [ ] **Step 8: Stop service**

`Ctrl-C`. Expected: shutdown logs `Telegram listener disconnected`, watcher closes, BullMQ closes.

No commit needed.

---

## Task 21: Deploy to Dokploy

**Files:** none

- [ ] **Step 1: Push the branch (already on main from previous tasks)**

Run: `git push origin main`

- [ ] **Step 2: Set env vars in Dokploy**

In Dokploy UI for `dca-crypto-bot/app`:

- `COPY_BYBIT_API_KEY` = your sub-account API key (or leave empty for now)
- `COPY_BYBIT_API_SECRET` = your sub-account API secret (or empty)
- `COPY_BYBIT_TESTNET` = `false`
- `COPY_INITIAL_CAPITAL_USDT_OVERRIDE` = empty (auto-detected from Bybit)

Other env vars already exist from F0.

- [ ] **Step 3: Auto-deploy fires from push**

Watch Dokploy deployments tab. Expected: build ~3 min, `Docker Compose Deployed ✅`.

- [ ] **Step 4: Verify**

```bash
ssh hostinger-vps 'docker logs --tail=40 dcacryptobot-app-oiiyui-copy-trader-1'
```

Expected log sequence:

- `Migrations complete`
- `Seeded config defaults` (first run only)
- `system_state row created` (first run only)
- `Bybit client initialized hasKey=<bool>`
- `system_state.initial_capital populated capital=<USDT>` (skipped if key unset)
- `Telegram listener connected`
- `Boot reconcile complete`
- `Watcher repeatable registered`
- `HTTP server listening`

- [ ] **Step 5: Smoke the dashboard**

Open https://dca-bot.luancunha.dev → log in → Copy Trader tab. Confirm:
- SystemStatePanel shows `ARMED` + initial capital (or `—` if key unset)
- StatsCard shows zeros across the board
- Config form shows 11 rows with defaults
- Trades table is empty
- Signals table still shows historical signals

- [ ] **Step 6: First real signal**

When Mack posts a signal in topic 4 and parser handles it cleanly:
- A `trades` row appears with `DRY_RUN_LOGGED`
- Telegram notify with parsed summary
- Dashboard updates within 30 s

After 1-2 weeks of correct dry-run plans, run the F2 plan (separate doc) to flip DRY_RUN and place real orders.

---

## Plan complete — self-review

**Coverage check:** All sections of the F1 spec are covered:

| Spec section | Plan task(s) |
|--------------|--------------|
| 4.3 Risk Gate | Task 7 |
| 4.4 Executor | Tasks 5, 8 |
| 4.5 Position Watcher | Tasks 9, 10 |
| 5. Data Model (existing) | Already in F0 migration |
| 6. Configuration (runtime) | Task 6 |
| 9. F1 phasing items | Tasks 1–21 |

**Placeholder scan:** No "TBD", "TODO", or hand-wave steps. Every code block is complete; every command shows the run target and expected output.

**Type consistency:** `ExecutorSignal` (executor) uses the same field names as `SignalIntent` (parser). `GateSignal` is a strict subset of `ExecutorSignal`. `CopyTrade` (shared) maps 1:1 to `trades` columns minus DB-only fields (signal_id is exposed, db `id` is exposed as `id`). `bybitOrderLinkId` is always set (we generate it locally before the API call), `bybitOrderId` is null in dry-run.

**Known limitation:** `inferCloseInfo` uses a 0.5–1% tolerance heuristic to classify CLOSED_TP vs CLOSED_SL vs CLOSED_MANUAL. For pairs with very tight TP/SL or for partial fills this can misclassify. The F2 plan will likely tighten this against `BybitExecution.closedPnl` sign + execType detail.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-18-copy-trader-f1-dry-run.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
