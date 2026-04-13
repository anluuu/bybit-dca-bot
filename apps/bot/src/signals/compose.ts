import type { SignalFallback } from "@dca/shared";
import { logger } from "../logger.js";
import { cacheGet, cacheSet } from "./cache.js";
import { computeMayer, type MayerSignal } from "./mayer.js";
import { computeMa200w, type Ma200wSignal } from "./ma200w.js";
import { getFearGreed, type FearGreedSignal } from "./feargreed.js";

/**
 * Equal-weighted composite of the three signal scores, mapped to a buy-size
 * multiplier in [0.5, 2.0].
 *
 * Design choices (locked in /sc:brainstorm):
 *   - equal weighting across Mayer, 200W MA, Fear & Greed
 *   - monthly cap is a hard ceiling; the caller clamps the multiplier against
 *     remaining-budget — this module only produces the unclamped multiplier
 *   - unused monthly budget is *forfeit* (not rolled forward) — also caller's
 *     concern
 *
 * Degradation tree (matches SignalFallback in @dca/shared):
 *   - "none"           : all three signals resolved
 *   - "feargreed_down" : FG API failed, use mayer + ma200w only
 *   - "klines_down"    : Bybit klines failed, use FG only
 *   - "all_down"       : nothing resolved — multiplier is forced to 1.0 so
 *                        the bot never skips a scheduled buy because the
 *                        signal infrastructure is down
 */

const COMPOSITE_CACHE_TTL_SECONDS = 5 * 60; // 5 min — fast enough for dashboards
const COMPOSITE_CACHE_KEY_PREFIX = "signals:composite";

const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 2.0;

export interface CompositeSignal {
  mayer: MayerSignal | null;
  ma200w: Ma200wSignal | null;
  fearGreed: FearGreedSignal | null;
  /** Mean of non-null scores, or 0 when all_down. */
  composite: number;
  /** [0.5, 2.0]. Forced to 1.0 when fallback === "all_down". */
  multiplier: number;
  fallback: SignalFallback;
  generatedAt: string;
}

/**
 * Map a composite score in [-1, 1] to a multiplier in [0.5, 2.0], piecewise
 * linear with 0 → 1.0 as the anchor. Linear (vs sigmoid) is chosen for v1
 * because the shape is easier to reason about and backtest; revisit after
 * backtest results if the curve feels too aggressive at the extremes.
 */
function compositeToMultiplier(composite: number): number {
  if (composite >= 1) return MULTIPLIER_MAX;
  if (composite <= -1) return MULTIPLIER_MIN;
  if (composite >= 0) {
    // [0, 1] → [1.0, 2.0]
    return 1 + composite * (MULTIPLIER_MAX - 1);
  }
  // [-1, 0) → [0.5, 1.0)
  return 1 + composite * (1 - MULTIPLIER_MIN);
}

/**
 * Pure: takes the three resolved (or nulled) signals and returns the composite.
 * Exported for the backtest harness — ensures live and historical paths use
 * identical math.
 */
export function composeMultiplier(
  mayer: MayerSignal | null,
  ma200w: Ma200wSignal | null,
  fearGreed: FearGreedSignal | null
): { composite: number; multiplier: number; fallback: SignalFallback } {
  const klinesDown = !mayer && !ma200w;
  const fgDown = !fearGreed;

  let fallback: SignalFallback;
  if (klinesDown && fgDown) fallback = "all_down";
  else if (klinesDown) fallback = "klines_down";
  else if (fgDown) fallback = "feargreed_down";
  else fallback = "none";

  // Safety: never skip a scheduled buy because signals are dark.
  if (fallback === "all_down") {
    return { composite: 0, multiplier: 1, fallback };
  }

  const scores: number[] = [];
  if (mayer) scores.push(mayer.score);
  if (ma200w) scores.push(ma200w.score);
  if (fearGreed) scores.push(fearGreed.score);

  const composite = scores.reduce((s, v) => s + v, 0) / scores.length;
  return {
    composite,
    multiplier: compositeToMultiplier(composite),
    fallback,
  };
}

/**
 * Resolve a single signal independently so a failure in one source doesn't
 * drag the rest down. We log the individual failure and keep going.
 */
async function safeResolve<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Signal resolution failed", {
      signal: label,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Live fetcher with Redis cache. Pair is required so klines target the right market. */
export async function getCompositeSignal(
  pair: string
): Promise<CompositeSignal> {
  const cacheKey = `${COMPOSITE_CACHE_KEY_PREFIX}:${pair}`;
  const cached = await cacheGet<CompositeSignal>(cacheKey);
  if (cached) return cached;

  const [mayer, ma200w, fearGreed] = await Promise.all([
    safeResolve("mayer", () => computeMayer(pair)),
    safeResolve("ma200w", () => computeMa200w(pair)),
    safeResolve("feargreed", () => getFearGreed()),
  ]);

  const { composite, multiplier, fallback } = composeMultiplier(
    mayer,
    ma200w,
    fearGreed
  );

  const signal: CompositeSignal = {
    mayer,
    ma200w,
    fearGreed,
    composite,
    multiplier,
    fallback,
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, signal, COMPOSITE_CACHE_TTL_SECONDS);
  return signal;
}
