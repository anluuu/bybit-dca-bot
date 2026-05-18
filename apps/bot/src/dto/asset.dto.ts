import type { Asset as WireAsset } from "@dca/shared";
import type { Asset } from "../db/schema.js";

/**
 * Map a Drizzle Asset row to the admin wire type.
 * Timestamps are serialized to ISO strings.
 */
export function mapAssetRowToWire(r: Asset): WireAsset {
  return {
    id: r.id,
    pair: r.pair,
    buyAmount: r.buyAmount,
    monthlyCap: r.monthlyCap,
    cronSchedule: r.cronSchedule,
    limitDiscount: r.limitDiscount,
    limitWaitMins: r.limitWaitMins,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
