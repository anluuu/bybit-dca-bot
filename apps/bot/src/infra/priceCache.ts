import { getTickerPrice } from "./exchange.js";
import { logger } from "../logger.js";

const TTL_MS = 60_000;

interface CacheEntry {
  price: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

export interface PriceLookup {
  /** null only if we have never successfully fetched this pair. */
  price: number | null;
  /** ISO timestamp of the price (cached or freshly fetched). */
  fetchedAt: string;
  /** true if the cache was expired AND the latest fetch failed; the price (if any) is older than TTL_MS. */
  stale: boolean;
}

export async function getPrice(pair: string): Promise<PriceLookup> {
  const now = Date.now();
  const cached = cache.get(pair);

  if (cached && now - cached.fetchedAt < TTL_MS) {
    return {
      price: cached.price,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      stale: false,
    };
  }

  // Coalesce concurrent refetches. Multiple requests arriving after TTL
  // expiry would otherwise each call Bybit; serialize them onto one fetch.
  let pending = inflight.get(pair);
  if (!pending) {
    pending = (async () => {
      try {
        const price = await getTickerPrice(pair);
        cache.set(pair, { price, fetchedAt: Date.now() });
      } catch (error) {
        // Degraded state, not an incident. Keep the stale entry (if any)
        // and let callers serve it with stale=true.
        logger.warn("Price refresh failed; serving stale cache", {
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inflight.delete(pair);
      }
    })();
    inflight.set(pair, pending);
  }
  await pending;

  const after = cache.get(pair);
  if (after && Date.now() - after.fetchedAt < TTL_MS) {
    return {
      price: after.price,
      fetchedAt: new Date(after.fetchedAt).toISOString(),
      stale: false,
    };
  }

  if (after) {
    // Have a previous successful fetch but the refresh just failed.
    return {
      price: after.price,
      fetchedAt: new Date(after.fetchedAt).toISOString(),
      stale: true,
    };
  }

  // Never had a successful fetch.
  return {
    price: null,
    fetchedAt: new Date().toISOString(),
    stale: true,
  };
}
