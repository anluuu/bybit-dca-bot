import { getDailyCloses } from "./klines.js";

/**
 * Mayer Multiple = spot / 200-day SMA.
 *
 * Historical context (BTC/USD, decades of data):
 *   - < 1.0 : "value" zone (market trades below its own long-term trend)
 *   - 1.0   : at the 200d SMA — neutral
 *   - > 2.4 : Trace Mayer's original "too hot" threshold, empirically rare
 *
 * We map the multiple into a -1..+1 score where +1 means "strongly cheap, buy
 * more". The breakpoints are set so extreme zones clamp cleanly:
 *   - multiple ≤ 0.8 → +1.0 (deep accumulation zone)
 *   - multiple = 1.0 → 0.0
 *   - multiple ≥ 2.4 → -1.0 (euphoria — ease off)
 *   - linear interpolation between
 */

const BULL_CLAMP = 0.8;   // at/below this, we scream buy
const BEAR_CLAMP = 2.4;   // at/above this, we scream back off
const NEUTRAL = 1.0;

export interface MayerSignal {
  /** Most recent close price. */
  spot: number;
  /** 200-day simple moving average. */
  sma200: number;
  /** spot / sma200. */
  multiple: number;
  /** -1..+1. */
  score: number;
}

/** Pure: used by both the live path and the backtest harness. */
export function scoreMayer(multiple: number): number {
  if (multiple <= BULL_CLAMP) return 1;
  if (multiple >= BEAR_CLAMP) return -1;
  if (multiple <= NEUTRAL) {
    // interpolate [BULL_CLAMP, NEUTRAL] → [+1, 0]
    return (NEUTRAL - multiple) / (NEUTRAL - BULL_CLAMP);
  }
  // interpolate (NEUTRAL, BEAR_CLAMP] → (0, -1]
  return -((multiple - NEUTRAL) / (BEAR_CLAMP - NEUTRAL));
}

/** Pure: takes closes oldest → newest and returns the live signal. */
export function computeMayerFromCloses(closes: number[]): MayerSignal {
  if (closes.length < 200) {
    throw new Error(
      `Need at least 200 daily closes for Mayer Multiple; got ${closes.length}`
    );
  }
  // Use the last 200 closes (inclusive of the latest bar) for the SMA.
  // `spot` is that latest close.
  const window = closes.slice(-200);
  const sma200 = window.reduce((sum, c) => sum + c, 0) / 200;
  const spot = closes[closes.length - 1];
  const multiple = spot / sma200;
  return { spot, sma200, multiple, score: scoreMayer(multiple) };
}

/** Live wrapper — fetches 200 daily closes from Bybit and applies the pure fn. */
export async function computeMayer(pair: string): Promise<MayerSignal> {
  const { closes } = await getDailyCloses(pair, 200);
  return computeMayerFromCloses(closes);
}
