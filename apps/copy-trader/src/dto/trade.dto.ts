import type { CopyTrade, CopyTradeStatus } from "@dca/shared";
import type { Trade } from "../db/schema.js";

export function mapTradeRowToWire(r: Trade): CopyTrade {
  return {
    id: r.id,
    signalId: r.signalId,
    symbol: r.symbol,
    direction: r.direction as "LONG" | "SHORT",
    bybitOrderId: r.bybitOrderId,
    bybitOrderLinkId: r.bybitOrderLinkId,
    plannedQty: r.plannedQty,
    plannedMargin: r.plannedMargin,
    leverageUsed: r.leverageUsed,
    entryStrategy: r.entryStrategy as "MARKET" | "LIMIT_CHASE",
    limitPrice: r.limitPrice,
    limitExpiresAt: r.limitExpiresAt?.toISOString() ?? null,
    filledQty: r.filledQty,
    avgEntry: r.avgEntry,
    fillTs: r.fillTs?.toISOString() ?? null,
    tpPrice: r.tpPrice,
    slPrice: r.slPrice,
    status: r.status as CopyTradeStatus,
    closeReason: r.closeReason,
    exitPrice: r.exitPrice,
    closeTs: r.closeTs?.toISOString() ?? null,
    pnlUsdt: r.pnlUsdt,
    feesUsdt: r.feesUsdt,
    errorMessage: r.errorMessage,
    dryRun: r.dryRun,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
