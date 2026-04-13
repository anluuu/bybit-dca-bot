import axios from "axios";
import { logger } from "../logger.js";
import { cacheGet, cacheSet } from "./cache.js";

/**
 * Crypto Fear & Greed Index from alternative.me.
 *
 * This is a single asset-agnostic number (0–100) for the whole crypto market.
 * We convert to a -1..+1 score where extreme fear (0) maps to +1 (strong buy
 * sentiment-wise) and extreme greed (100) maps to -1.
 *
 * The alternative.me API is free, no key required, and rate-limits generously.
 * Docs: https://alternative.me/crypto/fear-and-greed-index/
 */

const CACHE_KEY = "signals:feargreed";
const CACHE_TTL_SECONDS = 60 * 60; // value updates daily — 1h is safe

interface FearGreedApiResponse {
  data: Array<{
    value: string;           // "34"
    value_classification: string; // "Fear"
    timestamp: string;
    time_until_update?: string;
  }>;
}

export interface FearGreedSignal {
  value: number;            // 0..100
  classification: string;   // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  score: number;            // -1..+1
}

/** Pure: (50 - value) / 50 — so 0 → +1, 50 → 0, 100 → -1. */
export function scoreFearGreed(value: number): number {
  return (50 - value) / 50;
}

export async function getFearGreed(): Promise<FearGreedSignal> {
  const cached = await cacheGet<FearGreedSignal>(CACHE_KEY);
  if (cached) return cached;

  const { data } = await axios.get<FearGreedApiResponse>(
    "https://api.alternative.me/fng/",
    { params: { limit: 1 }, timeout: 10_000 }
  );

  const row = data.data?.[0];
  if (!row) {
    throw new Error("Fear & Greed API returned empty payload");
  }

  const value = parseInt(row.value, 10);
  const signal: FearGreedSignal = {
    value,
    classification: row.value_classification,
    score: scoreFearGreed(value),
  };

  await cacheSet(CACHE_KEY, signal, CACHE_TTL_SECONDS);
  logger.info("Fear & Greed refreshed", {
    value: signal.value,
    classification: signal.classification,
  });
  return signal;
}
