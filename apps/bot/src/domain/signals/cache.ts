import type { Redis } from "ioredis";
import { logger } from "../../logger.js";

/**
 * Signal data cache backed by the shared Redis connection.
 *
 * We reuse the existing BullMQ Redis instance (initialized in src/queue.ts
 * and passed in at boot from index.ts) rather than opening a second connection:
 *   - operationally simpler (one TTL/eviction policy, one connection count)
 *   - caches survive bot restarts (kline history doesn't change for hours)
 *   - horizontally-shared if the bot ever scales to multiple replicas
 *
 * Cache misses degrade gracefully — `get` returns null and callers recompute.
 */

let redis: Redis | null = null;

export function initSignalsCache(connection: Redis): void {
  redis = connection;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn("Signal cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    // Cache write failure is non-fatal — the read path will just miss next time.
    logger.warn("Signal cache write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
