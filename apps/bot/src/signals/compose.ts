import type { SignalFallback } from "@dca/shared";
import { logger } from "../logger.js";
import { cacheGet, cacheSet } from "./cache.js";
import { computeMayer, type MayerSignal } from "./mayer.js";
import { computeMa200w, type Ma200wSignal } from "./ma200w.js";
import { getFearGreed, type FearGreedSignal } from "./feargreed.js";

/**
 * Equal-weighted composite of the three market-signal scores. Purely
 * contextual — the bot's buy size does not react to this value; it just
 * populates the dashboard and per-order badges.
 *
 * Degradation tree (matches SignalFallback in @dca/shared):
 *   - "none"           : all three signals resolved
 *   - "feargreed_down" : FG API failed, composite uses mayer + ma200w
 *   - "klines_down"    : Bybit klines failed, composite uses FG only
 *   - "all_down"       : nothing resolved, composite forced to 0 (neutral)
 *
 * Failure of any individual source is absorbed here; callers never need to
 * try/catch.
 */

const COMPOSITE_CACHE_TTL_SECONDS = 5 * 60; // 5 min — fast enough for dashboards
const COMPOSITE_CACHE_KEY_PREFIX = "signals:composite";

export interface CompositeSignal {
  mayer: MayerSignal | null;
  ma200w: Ma200wSignal | null;
  fearGreed: FearGreedSignal | null;
  /** Mean of non-null scores in [-1, 1]. 0 when all signals are unavailable. */
  composite: number;
  fallback: SignalFallback;
  generatedAt: string;
}

/**
 * Pure: combine three (possibly null) signal snapshots into the composite
 * score and fallback flag. Exported so callers that already have the raw
 * signals in hand (e.g. a future offline analysis) can reuse the math.
 */
export function composeScore(
  mayer: MayerSignal | null,
  ma200w: Ma200wSignal | null,
  fearGreed: FearGreedSignal | null
): { composite: number; fallback: SignalFallback } {
  const klinesDown = !mayer && !ma200w;
  const fgDown = !fearGreed;

  let fallback: SignalFallback;
  if (klinesDown && fgDown) fallback = "all_down";
  else if (klinesDown) fallback = "klines_down";
  else if (fgDown) fallback = "feargreed_down";
  else fallback = "none";

  if (fallback === "all_down") {
    return { composite: 0, fallback };
  }

  const scores: number[] = [];
  if (mayer) scores.push(mayer.score);
  if (ma200w) scores.push(ma200w.score);
  if (fearGreed) scores.push(fearGreed.score);

  return {
    composite: scores.reduce((s, v) => s + v, 0) / scores.length,
    fallback,
  };
}

/**
 * Resolve a single signal independently so one source's failure doesn't drag
 * the others down. Logged and returned as null — callers don't see the error.
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

/** Live fetcher with Redis cache. Pair targets the correct kline market. */
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

  const { composite, fallback } = composeScore(mayer, ma200w, fearGreed);

  const signal: CompositeSignal = {
    mayer,
    ma200w,
    fearGreed,
    composite,
    fallback,
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, signal, COMPOSITE_CACHE_TTL_SECONDS);
  return signal;
}
