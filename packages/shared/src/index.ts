// Shared API contract types — used by both bot (server) and web (client).
// These describe the JSON wire format, not the database row shape.

export type OrderType = "limit" | "market";
export type OrderStatus =
  | "pending"
  | "filled"
  | "cancelled"
  | "failed"
  | "skipped_cap";

/**
 * Why the composite signal had to fall back to a degraded mode, or "none"
 * when all three signals resolved. Surfaces as a "data partially unavailable"
 * badge on the dashboard; the bot still buys at its baseline regardless.
 */
export type SignalFallback =
  | "none"
  | "feargreed_down"
  | "klines_down"
  | "all_down";

export interface Order {
  id: number;
  assetId: number;
  pair: string;
  orderType: string;
  bybitOrderId: string | null;
  status: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  errorMessage: string | null;
  isTest: boolean;
  // Signal snapshot at order placement. All nullable for historical rows and
  // for orders placed when signals were unavailable. These are captured for
  // dashboard context only — the bot's buy size does not react to them.
  mayerMultiple: string | null;
  ma200wDistancePct: string | null;
  fearGreedIndex: number | null;
  compositeScore: string | null;
  signalFallback: string | null;
  executedAt: string;
  createdAt: string;
}

/**
 * Dry-run preview of what a test order would do right now.
 * No order is placed. Generated on POST /api/test/preview.
 */
export interface TestOrderPreview {
  pair: string;
  testAmountBrl: number;
  currentPrice: number;
  estimatedQty: number;
  /** Monthly spend of *real* (non-test) orders; purely informational. */
  monthlySpent: number;
  monthlyCap: number;
  /** True if another pending/test order on this pair is active and execution would be blocked. */
  busy: boolean;
  busyReason: string | null;
  generatedAt: string;
}

/**
 * Result of a one-shot admin-triggered DCA run (POST /api/admin/run-now).
 * Unlike test orders, this executes the full DCA flow (limit → poll → market
 * fallback) and is NOT tagged is_test, so it counts toward the monthly cap
 * and appears in public history — intended for catching up a missed weekly
 * cron, not for sanity-checking.
 */
export interface AdminRunNowResult {
  pair: string;
  status: "started" | "failed";
  errorMessage: string | null;
  startedAt: string;
}

/**
 * Result of a real test order executed on POST /api/test/execute.
 * Always a small market order tagged is_test=true in the DB.
 */
export interface TestOrderResult {
  orderId: number;
  bybitOrderId: string | null;
  status: string;
  pair: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  errorMessage: string | null;
  executedAt: string;
}

export interface Asset {
  id: number;
  pair: string;
  buyAmount: string;
  monthlyCap: string;
  cronSchedule: string;
  limitDiscount: string;
  limitWaitMins: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrdersPage {
  data: Order[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrdersSummary {
  totalOrders: number;
  totalBtc: number;
  totalSpent: number;
  monthlySpent: number;
  monthlyCap: number;
  avgPrice: number;
}

export interface ChartPoint {
  date: string;
  btc: number;
  spent: number;
  /** Mayer Multiple at the time of this buy. Null if signal was unavailable
   * or the row pre-dates signal capture (historical backfill). */
  mayer: number | null;
  /** 200-week MA distance % at the time of this buy. Null if unavailable. */
  ma200wDistancePct: number | null;
}

/**
 * Per-calendar-month aggregation of filled, non-test orders.
 * `avgPrice` is volume-weighted (ΣBRL / ΣBTC), which is the meaningful
 * cost-basis for DCA — not the arithmetic mean of per-order prices.
 * `vsPrevPct` compares avgPrice to the previous (chronologically earlier)
 * month; negative values mean we bought cheaper this month.
 */
export interface MonthlyBreakdown {
  /** ISO yyyy-MM, stable for sort (e.g. "2026-03"). */
  month: string;
  /** Human label pre-formatted server-side (e.g. "Mar 2026"). */
  label: string;
  orderCount: number;
  totalBtc: number;
  totalSpent: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  /** null for the earliest month we have data for. */
  vsPrevPct: number | null;
}

/**
 * Public-safe variant. Historically stripped orderCount / min / max — now
 * identical to MonthlyBreakdown because those fields aren't escalatable
 * (they're derivable from the public chart anyway). Kept as an alias so
 * existing imports don't break.
 */
export type PublicMonthlyBreakdown = MonthlyBreakdown;

/**
 * Public-safe Order projection: strips DB primary keys, the vendor-side
 * Bybit order identifier, raw error messages (may contain stack traces or
 * API-key fragments), the is_test flag (public orders are always is_test=false),
 * and created_at (only executedAt is interesting to a viewer).
 *
 * Also strips internal scoring fields (compositeScore, signalFallback) —
 * public visitors see the raw market indicators (mayer, ma200w, fg) only.
 */
export type PublicOrder = Omit<
  Order,
  | "id"
  | "assetId"
  | "bybitOrderId"
  | "errorMessage"
  | "isTest"
  | "createdAt"
  | "compositeScore"
  | "signalFallback"
>;

export interface PublicOrdersPage {
  data: PublicOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Public-safe subset of the first configured asset: just the fields the
 * public StatusCard needs (pair, weekly buy amount, cron schedule, monthly
 * cap). Omits strategy-tuning fields like limitDiscount / limitWaitMins.
 */
export interface PublicStatus {
  pair: string;
  buyAmount: string;
  cronSchedule: string;
  monthlyCap: string;
}

export interface HealthStatus {
  status: string;
  uptime: number;
  postgres?: string;
  redis?: string;
}

export interface AuthUser {
  username: string;
  role: string;
}

/**
 * Live market-signal snapshot served by GET /api/public/signals.
 *
 * Exposes the three indicators that contextualize every DCA buy (Mayer
 * Multiple, 200W MA distance, Fear & Greed) and the monthly cap utilization.
 * The bot does NOT modulate its buy size based on these — they're purely
 * informational context for the dashboard. `fallback !== "none"` when a
 * signal source is unavailable.
 */
export interface PublicSignals {
  mayerMultiple: number | null;
  ma200wDistancePct: number | null;
  fearGreedIndex: number | null;
  fearGreedClassification: string | null;
  /** Equal-weighted composite of the non-null signals. -1 = expensive, +1 = cheap. */
  compositeScore: number | null;
  /** % of the monthly cap already spent. */
  capUtilizationPct: number | null;
  fallback: SignalFallback;
  generatedAt: string;
}

/**
 * Snapshot of unrealized PnL on the primary trading pair, served by
 * GET /api/public/pnl. Combines the already-public summary aggregates
 * (totalSpent, totalBtc, avgPrice) with the current Bybit spot price.
 *
 * The bot does NOT change behavior based on this data — it is purely a
 * dashboard indicator. `priceStale` flags when the ticker fetch is
 * failing and the values use a cached older price.
 */
export interface PortfolioPnl {
  pair: string;
  currentPrice: number | null;
  /** ISO timestamp of when currentPrice was fetched from Bybit. */
  priceAsOf: string;
  /** true when the ticker fetch failed and we are serving a cached older price. */
  priceStale: boolean;
  totalBtc: number;
  totalSpent: number;
  avgPrice: number;
  /** currentPrice × totalBtc. null when currentPrice is null. */
  portfolioValue: number | null;
  /** portfolioValue − totalSpent. null when currentPrice is null or totalBtc is 0. */
  unrealizedPnl: number | null;
  /** unrealizedPnl / totalSpent × 100. null when totalSpent is 0 or currentPrice is null. */
  roiPct: number | null;
  /** (currentPrice − avgPrice) / avgPrice × 100. null when avgPrice is 0 or currentPrice is null. */
  avgVsSpotPct: number | null;
  generatedAt: string;
}

// ============================================================================
// Copy-trader types (F0 only ships CopySignal; trades/stats added in F1/F2)
// ============================================================================

export type CopySignalStatus = "PARSED" | "UNPARSEABLE" | "SKIPPED" | "EXECUTED";

export interface CopySignal {
  id: string;
  signalHash: string;
  rawText: string;
  telegramMsgId: number;
  telegramSenderId: number | null;
  receivedAt: string;
  direction: "LONG" | "SHORT" | null;
  symbol: string | null;
  entryLow: string | null;
  entryHigh: string | null;
  stopLoss: string | null;
  leverageRaw: number | null;
  takeProfit1: string | null;
  takeProfit2: string | null;
  takeProfit3: string | null;
  status: CopySignalStatus;
  skipReason: string | null;
}

export interface CopySignalsPage {
  page: number;
  pageSize: number;
  total: number;
  items: CopySignal[];
}

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
