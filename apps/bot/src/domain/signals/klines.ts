import axios from "axios";
import { logger } from "../../logger.js";
import { cacheGet, cacheSet } from "./cache.js";

/**
 * Historical close-price fetcher for Bybit spot pairs.
 *
 * Uses the PUBLIC /v5/market/kline endpoint — no signing required. We keep a
 * dedicated axios instance so signals never pull on the signed exchange.ts
 * client (keeps the failure surfaces separate: if Bybit auth breaks, signals
 * still work, and vice versa).
 *
 * Returns closes oldest → newest, which is what every downstream indicator
 * (SMA, EMA, etc.) expects. Bybit returns newest → oldest; we reverse.
 */

const KLINE_CACHE_TTL_SECONDS = 60 * 60; // 1h — prices at this granularity move slowly

interface BybitKlineResponse {
  retCode: number;
  retMsg: string;
  result: {
    // list items: [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
    list: string[][];
  };
}

export interface Klines {
  /** Close prices, oldest → newest. */
  closes: number[];
  /** When the cache entry (or a fresh fetch) was last materialized. */
  updatedAt: string;
}

const bybit = axios.create({
  baseURL: "https://api.bybit.com",
  timeout: 10_000,
});

async function fetchKlines(
  pair: string,
  interval: "D" | "W",
  limit: number
): Promise<Klines> {
  const { data } = await bybit.get<BybitKlineResponse>("/v5/market/kline", {
    params: { category: "spot", symbol: pair, interval, limit },
  });

  if (data.retCode !== 0) {
    throw new Error(
      `Bybit kline error: ${data.retMsg} (code ${data.retCode})`
    );
  }

  if (!data.result.list?.length) {
    throw new Error(`Empty kline list for ${pair} interval=${interval}`);
  }

  // Bybit returns newest → oldest; we want oldest → newest so SMA math reads
  // naturally (closes[closes.length - 1] is the latest bar).
  const closes = data.result.list
    .map((row) => parseFloat(row[4]))
    .reverse();

  return { closes, updatedAt: new Date().toISOString() };
}

async function getCached(
  pair: string,
  interval: "D" | "W",
  count: number,
  cacheKey: string
): Promise<Klines> {
  const cached = await cacheGet<Klines>(cacheKey);
  if (cached && cached.closes.length >= count) {
    return cached;
  }

  const fresh = await fetchKlines(pair, interval, count);
  await cacheSet(cacheKey, fresh, KLINE_CACHE_TTL_SECONDS);
  logger.info("Klines refreshed", {
    pair,
    interval,
    count: fresh.closes.length,
  });
  return fresh;
}

/**
 * Daily closes — `count` most recent. Used by the Mayer Multiple (needs 200+
 * daily bars to compute its 200-day SMA plus today's spot).
 */
export function getDailyCloses(pair: string, count: number): Promise<Klines> {
  return getCached(pair, "D", count, `signals:klines:${pair}:daily:${count}`);
}

/**
 * Weekly closes — `count` most recent. Used by the 200-week MA distance.
 */
export function getWeeklyCloses(pair: string, count: number): Promise<Klines> {
  return getCached(pair, "W", count, `signals:klines:${pair}:weekly:${count}`);
}
