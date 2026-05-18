import type { Order as WireOrder, PublicOrder } from "@dca/shared";
import type { Order } from "../db/schema.js";

/**
 * Map a Drizzle Order row to the full admin wire type.
 * Timestamps are serialized to ISO strings; all other fields pass through as-is.
 */
export function mapOrderRowToWire(r: Order): WireOrder {
  return {
    id: r.id,
    assetId: r.assetId,
    pair: r.pair,
    orderType: r.orderType,
    bybitOrderId: r.bybitOrderId ?? null,
    status: r.status,
    price: r.price ?? null,
    quantity: r.quantity ?? null,
    fiatSpent: r.fiatSpent ?? null,
    fee: r.fee ?? null,
    feeCurrency: r.feeCurrency ?? null,
    errorMessage: r.errorMessage ?? null,
    isTest: r.isTest,
    mayerMultiple: r.mayerMultiple ?? null,
    ma200wDistancePct: r.ma200wDistancePct ?? null,
    fearGreedIndex: r.fearGreedIndex ?? null,
    compositeScore: r.compositeScore ?? null,
    signalFallback: r.signalFallback ?? null,
    executedAt: r.executedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Map a Drizzle Order row to the public-safe wire type.
 * Strips DB primary keys, bybitOrderId, errorMessage, isTest, createdAt,
 * compositeScore, and signalFallback — per PublicOrder type definition in
 * @dca/shared.
 */
export function mapOrderRowToPublicWire(r: {
  pair: string;
  orderType: string;
  status: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  mayerMultiple: string | null;
  ma200wDistancePct: string | null;
  fearGreedIndex: number | null;
  executedAt: Date;
}): PublicOrder {
  return {
    pair: r.pair,
    orderType: r.orderType,
    status: r.status,
    price: r.price ?? null,
    quantity: r.quantity ?? null,
    fiatSpent: r.fiatSpent ?? null,
    fee: r.fee ?? null,
    feeCurrency: r.feeCurrency ?? null,
    mayerMultiple: r.mayerMultiple ?? null,
    ma200wDistancePct: r.ma200wDistancePct ?? null,
    fearGreedIndex: r.fearGreedIndex ?? null,
    executedAt: r.executedAt.toISOString(),
  };
}
