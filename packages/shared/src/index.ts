// Shared API contract types — used by both bot (server) and web (client).
// These describe the JSON wire format, not the database row shape.

export type OrderType = "limit" | "market";
export type OrderStatus =
  | "pending"
  | "filled"
  | "cancelled"
  | "failed"
  | "skipped_cap"
  // New in signal-aware DCA: fires when the composite multiplier would have
  // produced a buy amount below Bybit's minimum order size — distinct from
  // skipped_cap so the dashboard can explain *why* a week was skipped.
  | "skipped_min_order";

/**
 * Why the composite score had to fall back to a degraded mode, or "none" if
 * all three signals resolved. When "all_down" the bot buys at 1× (flat DCA)
 * so we never miss a scheduled buy because of signal infrastructure.
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
  // for orders placed when signals were unavailable.
  mayerMultiple: string | null;
  ma200wDistancePct: string | null;
  fearGreedIndex: number | null;
  compositeScore: string | null;
  appliedMultiplier: string | null;
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
 * Also strips strategy-internal signal fields:
 *   - compositeScore / appliedMultiplier: reveal the internal scoring function
 *     and in-flight sizing decisions; public visitors see raw index values
 *     (mayer, ma200w, fg) which are market data and safe to expose.
 *   - signalFallback: surfaces our internal degradation tree; admin-only.
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
  | "appliedMultiplier"
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
 * Live signal snapshot served by GET /api/public/signals.
 *
 * Public visitors see the raw market indicators (Mayer, 200W MA distance,
 * Fear & Greed) and the monthly *utilization percentage*. We deliberately
 * hide absolute BRL cap remaining and the multiplier that *would* be applied
 * to the next DCA — those are strategy-tuning values that leak the bot's
 * internal decision function when a buy is imminent.
 *
 * When `fallback !== "none"` some signals failed to resolve and the composite
 * falls back to a degraded path (or flat 1× buys when "all_down").
 */
export interface PublicSignals {
  mayerMultiple: number | null;
  ma200wDistancePct: number | null;
  fearGreedIndex: number | null;
  fearGreedClassification: string | null;
  /** Equal-weighted composite of the non-null signals. -1 = expensive, +1 = cheap. */
  compositeScore: number | null;
  /** % of the monthly cap already spent — does NOT expose the absolute BRL. */
  capUtilizationPct: number | null;
  fallback: SignalFallback;
  generatedAt: string;
}

/**
 * Admin variant of PublicSignals with the absolute BRL envelope and the
 * multiplier that would be applied to the next DCA. Behind authPreHandler.
 */
export interface AdminSignals extends PublicSignals {
  /** [0.5, 2.0] — would be applied if a DCA fired right now. */
  nextBuyMultiplier: number;
  monthlySpent: number;
  monthlyCap: number;
  monthlyRemaining: number;
  /** buyAmount × nextBuyMultiplier, then clamped to monthlyRemaining. */
  previewAmountBrl: number;
}
