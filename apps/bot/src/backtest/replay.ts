import { composeMultiplier } from "../signals/compose.js";
import { computeMayerFromCloses } from "../signals/mayer.js";
import { computeMa200wFromCloses } from "../signals/ma200w.js";
import { scoreFearGreed } from "../signals/feargreed.js";

/**
 * Historical replay of the DCA strategy.
 *
 * Key invariant: the modulated strategy calls the EXACT same `composeMultiplier`
 * that the live bot uses in `signals/compose.ts`. We inject signals as values
 * rather than fetching them — this is the only way to guarantee the backtest
 * validates the algorithm that actually ships.
 *
 * No look-ahead bias: on each simulated Sunday we only look at close-prices and
 * FG values on-or-before that date.
 */

export interface DailyPoint {
  /** ISO date "YYYY-MM-DD" (UTC). */
  date: string;
  /** Closing price for that day. */
  close: number;
}

export interface FearGreedPoint {
  date: string;
  /** 0..100 */
  value: number;
}

export interface BacktestInput {
  /** Oldest → newest. Must include at least 200 daily bars before `start`. */
  dailyPrices: DailyPoint[];
  /** Daily Fear & Greed values. Missing dates are tolerated (signal degrades). */
  fearGreed: FearGreedPoint[];
  /** Inclusive. Backtest only places buys on Sundays ≥ start. */
  start: Date;
  /** Inclusive. */
  end: Date;
  /** Baseline weekly buy amount (BRL). Gets scaled by the multiplier. */
  weeklyBrl: number;
  /** Hard monthly ceiling (BRL). Never breached. Unused budget is forfeit. */
  monthlyCapBrl: number;
  /** Minimum order size — below this, the buy is skipped. */
  minOrderBrl: number;
}

export interface StrategyBuy {
  date: string;
  close: number;
  spentBrl: number;
  btcAcquired: number;
  multiplier: number;
  skippedReason: "none" | "skipped_cap" | "skipped_min_order";
}

export interface StrategyResult {
  buys: StrategyBuy[];
  totalSpent: number;
  totalBtc: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
  /** Percent of possible cap that was actually spent. */
  capUtilizationPct: number;
  /** Max % drawdown from peak BTC-value-at-time to later trough. */
  maxDrawdownPct: number;
}

export interface BacktestResult {
  flat: StrategyResult;
  modulated: StrategyResult;
  /** Sats delta (modulated − flat). Positive means modulation was better. */
  btcDelta: number;
  /** Average price delta (modulated − flat). Negative = modulated bought cheaper. */
  avgPriceDelta: number;
}

// --- Helpers ------------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonthUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Advance to the next Sunday (or stay put if already Sunday). */
function firstSundayOnOrAfter(d: Date): Date {
  const r = new Date(d);
  const day = r.getUTCDay(); // 0=Sun
  const add = day === 0 ? 0 : 7 - day;
  r.setUTCDate(r.getUTCDate() + add);
  r.setUTCHours(8, 0, 0, 0);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Index daily prices by ISO date for O(1) lookup. */
function indexDaily(dailyPrices: DailyPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of dailyPrices) map.set(p.date, p.close);
  return map;
}

function indexFearGreed(fg: FearGreedPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of fg) map.set(p.date, p.value);
  return map;
}

/**
 * Find the most recent close on or before the given date. Bybit may miss rare
 * days (exchange downtime); we walk backwards up to 7 days.
 */
function closeOnOrBefore(
  index: Map<string, number>,
  date: Date
): number | null {
  for (let i = 0; i < 7; i++) {
    const val = index.get(ymd(addDays(date, -i)));
    if (val !== undefined) return val;
  }
  return null;
}

function fgOnOrBefore(
  index: Map<string, number>,
  date: Date
): number | null {
  for (let i = 0; i < 7; i++) {
    const val = index.get(ymd(addDays(date, -i)));
    if (val !== undefined) return val;
  }
  return null;
}

/**
 * Slice of daily closes up to and including `date`, oldest → newest. Used to
 * feed the indicator functions with exactly the history they'd have seen.
 */
function closesUpTo(
  dailyPrices: DailyPoint[],
  date: Date,
  maxCount: number
): number[] {
  const cutoff = ymd(date);
  const upto: number[] = [];
  for (const p of dailyPrices) {
    if (p.date <= cutoff) upto.push(p.close);
    else break;
  }
  return upto.slice(-maxCount);
}

/**
 * Convert daily → weekly closes by picking the last daily close on or before
 * each Sunday. This matches Bybit's `interval=W` semantics well enough for
 * our 200-week MA, and avoids needing a separate weekly CSV.
 */
function weeklyClosesUpTo(
  dailyPrices: DailyPoint[],
  date: Date,
  weeks: number
): number[] {
  const weekly: number[] = [];
  const cutoff = ymd(date);
  const dailyIndex = indexDaily(dailyPrices);

  // Walk backwards from `date` by 7-day strides, looking up the close
  // on-or-before each stride boundary.
  for (let i = 0; i < weeks; i++) {
    const probe = addDays(date, -7 * i);
    if (ymd(probe) > cutoff) continue;
    const close = closeOnOrBefore(dailyIndex, probe);
    if (close !== null) weekly.unshift(close);
    else break;
  }
  return weekly;
}

// --- Core replay --------------------------------------------------------

function summarize(buys: StrategyBuy[]): StrategyResult {
  const filled = buys.filter((b) => b.skippedReason === "none");
  const totalSpent = filled.reduce((s, b) => s + b.spentBrl, 0);
  const totalBtc = filled.reduce((s, b) => s + b.btcAcquired, 0);
  const avgPrice = totalBtc > 0 ? totalSpent / totalBtc : 0;

  // Running portfolio value at each buy, for drawdown computation.
  let runningBtc = 0;
  const btcValues: Array<{ date: string; value: number }> = [];
  for (const b of buys) {
    if (b.skippedReason === "none") runningBtc += b.btcAcquired;
    btcValues.push({ date: b.date, value: runningBtc * b.close });
  }

  let peak = 0;
  let maxDrawdownPct = 0;
  for (const pt of btcValues) {
    if (pt.value > peak) peak = pt.value;
    if (peak > 0) {
      const dd = ((peak - pt.value) / peak) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  return {
    buys,
    totalSpent,
    totalBtc,
    avgPrice,
    capUtilizationPct: 0, // filled later by caller (needs cap + month count)
    maxDrawdownPct,
  };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const { dailyPrices, fearGreed, start, end, weeklyBrl, monthlyCapBrl, minOrderBrl } = input;
  const dailyIndex = indexDaily(dailyPrices);
  const fgIndex = indexFearGreed(fearGreed);

  const flatBuys: StrategyBuy[] = [];
  const modBuys: StrategyBuy[] = [];

  // Track per-strategy per-month spending for cap enforcement.
  const flatMonthSpent = new Map<string, number>();
  const modMonthSpent = new Map<string, number>();

  for (
    let sunday = firstSundayOnOrAfter(start);
    sunday <= end;
    sunday = addDays(sunday, 7)
  ) {
    const dateStr = ymd(sunday);
    const close = closeOnOrBefore(dailyIndex, sunday);
    if (close === null) continue; // no price data for this week (pre-listing gap etc)

    const monthKey = startOfMonthUtc(sunday);

    // --- Flat strategy: always tries to buy weeklyBrl, clamped to cap -----
    const flatSpent = flatMonthSpent.get(monthKey) ?? 0;
    const flatRemaining = monthlyCapBrl - flatSpent;
    const flatThisWeek = Math.min(weeklyBrl, Math.max(flatRemaining, 0));
    if (flatThisWeek < minOrderBrl) {
      flatBuys.push({
        date: dateStr,
        close,
        spentBrl: 0,
        btcAcquired: 0,
        multiplier: 1,
        skippedReason:
          flatRemaining <= 0 ? "skipped_cap" : "skipped_min_order",
      });
    } else {
      flatBuys.push({
        date: dateStr,
        close,
        spentBrl: flatThisWeek,
        btcAcquired: flatThisWeek / close,
        multiplier: 1,
        skippedReason: "none",
      });
      flatMonthSpent.set(monthKey, flatSpent + flatThisWeek);
    }

    // --- Modulated strategy: compute signals from history, apply multiplier
    const dailyHist = closesUpTo(dailyPrices, sunday, 200);
    const weeklyHist = weeklyClosesUpTo(dailyPrices, sunday, 200);
    const fgValue = fgOnOrBefore(fgIndex, sunday);

    const mayer =
      dailyHist.length >= 200 ? computeMayerFromCloses(dailyHist) : null;
    const ma200w =
      weeklyHist.length >= 200 ? computeMa200wFromCloses(weeklyHist) : null;
    const fg =
      fgValue !== null
        ? {
            value: fgValue,
            classification: "", // not needed for scoring
            score: scoreFearGreed(fgValue),
          }
        : null;

    const { multiplier } = composeMultiplier(mayer, ma200w, fg);

    const modSpent = modMonthSpent.get(monthKey) ?? 0;
    const modRemaining = monthlyCapBrl - modSpent;
    const modCandidate = weeklyBrl * multiplier;
    const modThisWeek = Math.min(modCandidate, Math.max(modRemaining, 0));
    if (modThisWeek < minOrderBrl) {
      modBuys.push({
        date: dateStr,
        close,
        spentBrl: 0,
        btcAcquired: 0,
        multiplier,
        skippedReason:
          modRemaining <= 0 ? "skipped_cap" : "skipped_min_order",
      });
    } else {
      modBuys.push({
        date: dateStr,
        close,
        spentBrl: modThisWeek,
        btcAcquired: modThisWeek / close,
        multiplier,
        skippedReason: "none",
      });
      modMonthSpent.set(monthKey, modSpent + modThisWeek);
    }
  }

  const flatResult = summarize(flatBuys);
  const modResult = summarize(modBuys);

  // Cap utilization: spent ÷ (cap × distinct months in range).
  const distinctMonths = new Set<string>();
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    distinctMonths.add(startOfMonthUtc(d));
  }
  const possibleSpend = distinctMonths.size * monthlyCapBrl;
  flatResult.capUtilizationPct =
    possibleSpend > 0 ? (flatResult.totalSpent / possibleSpend) * 100 : 0;
  modResult.capUtilizationPct =
    possibleSpend > 0 ? (modResult.totalSpent / possibleSpend) * 100 : 0;

  return {
    flat: flatResult,
    modulated: modResult,
    btcDelta: modResult.totalBtc - flatResult.totalBtc,
    avgPriceDelta: modResult.avgPrice - flatResult.avgPrice,
  };
}
