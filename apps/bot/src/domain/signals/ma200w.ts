import { getWeeklyCloses } from "./klines.js";

/**
 * 200-week moving average distance.
 *
 * The 200W SMA has historically been the *floor* of Bitcoin bear markets —
 * price reaching or going below it has been a strong accumulation signal in
 * every prior cycle. Distance above is a rough "how stretched are we" gauge.
 *
 * Score mapping (distance % = (spot − ma) / ma × 100):
 *   - distance ≤ -20% → +1.0 (deeply below the line; historical floor)
 *   - distance = 0%   → 0.0
 *   - distance ≥ +400% → -1.0 (cycle-top zone)
 *   - piecewise linear between
 */

const BULL_CLAMP_PCT = -20;   // at/below: strong buy
const BEAR_CLAMP_PCT = 400;   // at/above: strong ease-off
const NEUTRAL_PCT = 0;

export interface Ma200wSignal {
  spot: number;
  ma200w: number;
  distancePct: number;
  score: number;
}

export function scoreMa200w(distancePct: number): number {
  if (distancePct <= BULL_CLAMP_PCT) return 1;
  if (distancePct >= BEAR_CLAMP_PCT) return -1;
  if (distancePct <= NEUTRAL_PCT) {
    return (NEUTRAL_PCT - distancePct) / (NEUTRAL_PCT - BULL_CLAMP_PCT);
  }
  return -(distancePct - NEUTRAL_PCT) / (BEAR_CLAMP_PCT - NEUTRAL_PCT);
}

export function computeMa200wFromCloses(closes: number[]): Ma200wSignal {
  if (closes.length < 200) {
    throw new Error(
      `Need at least 200 weekly closes for 200W MA; got ${closes.length}`
    );
  }
  const window = closes.slice(-200);
  const ma200w = window.reduce((sum, c) => sum + c, 0) / 200;
  const spot = closes[closes.length - 1];
  const distancePct = ((spot - ma200w) / ma200w) * 100;
  return { spot, ma200w, distancePct, score: scoreMa200w(distancePct) };
}

export async function computeMa200w(pair: string): Promise<Ma200wSignal> {
  const { closes } = await getWeeklyCloses(pair, 200);
  return computeMa200wFromCloses(closes);
}
