import { db } from "./db/client.js";
import { trades, dailyStats, systemState } from "./db/schema.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  getOrderByLinkId,
  getPosition,
  getRecentExecutions,
  type BybitOrder,
  type BybitExecution,
} from "./bybit.js";
import { getConfigNumber } from "./configStore.js";
import { notifyLifecycle } from "./notifications.js";

const ACTIVE_STATUSES = ["PENDING_FILL", "OPEN"] as const;

export async function watcherTick(): Promise<void> {
  const open = await db
    .select()
    .from(trades)
    .where(and(eq(trades.dryRun, false), inArray(trades.status, ACTIVE_STATUSES as unknown as string[])));

  if (open.length === 0) return;

  for (const t of open) {
    try {
      await reconcileTrade(t);
    } catch (e) {
      logger.error("watcher: reconcile failed", {
        tradeId: t.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function reconcileTrade(t: typeof trades.$inferSelect): Promise<void> {
  const order = await getOrderByLinkId(t.bybitOrderLinkId);
  const position = await getPosition(t.symbol);

  // PENDING_FILL transitions
  if (t.status === "PENDING_FILL") {
    if (order && (order.orderStatus === "Filled" || order.orderStatus === "PartiallyFilled")) {
      await db
        .update(trades)
        .set({
          status: "OPEN",
          filledQty: order.cumExecQty,
          avgEntry: order.avgPrice,
          fillTs: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(trades.id, t.id));
      logger.info("Order filled", { tradeId: t.id, avgPrice: order.avgPrice });
      void notifyLifecycle(`filled ${t.symbol}`, `@ ${order.avgPrice}`);
      return;
    }
    if (order && (order.orderStatus === "Cancelled" || order.orderStatus === "Rejected")) {
      await db
        .update(trades)
        .set({ status: "NOT_FILLED", updatedAt: new Date() })
        .where(eq(trades.id, t.id));
      logger.info("Order cancelled before fill", { tradeId: t.id });
      void notifyLifecycle(`not filled ${t.symbol}`, order.orderStatus);
      return;
    }
    return; // still pending
  }

  // OPEN → closed?
  if (t.status === "OPEN") {
    if (position) return; // still open
    const closeInfo = await inferCloseInfo(t, order);
    await db
      .update(trades)
      .set({
        status: closeInfo.status,
        closeReason: closeInfo.reason,
        exitPrice: closeInfo.exitPrice,
        closeTs: new Date(),
        pnlUsdt: closeInfo.pnl,
        feesUsdt: closeInfo.fees,
        updatedAt: new Date(),
      })
      .where(eq(trades.id, t.id));

    const pnl = Number(closeInfo.pnl ?? "0");
    await accumulateDailyStats(pnl);
    if (pnl < 0) {
      const cooldownMin = await getConfigNumber("COOLDOWN_MIN_AFTER_LOSS");
      const until = new Date(Date.now() + cooldownMin * 60_000);
      await db.update(systemState).set({
        cooldownUntil: until,
        cooldownReason: `Loss on ${t.symbol}`,
        updatedAt: new Date(),
      }).where(eq(systemState.id, 1));
    }

    logger.info("Trade closed", {
      tradeId: t.id,
      reason: closeInfo.reason,
      pnl,
    });
    void notifyLifecycle(
      `${closeInfo.status.toLowerCase()} ${t.symbol}`,
      `pnl ${pnl.toFixed(2)} USDT`
    );
  }
}

interface CloseInfo {
  status: "CLOSED_TP" | "CLOSED_SL" | "CLOSED_MANUAL" | "LIQUIDATED";
  reason: string;
  exitPrice: string | null;
  pnl: string | null;
  fees: string | null;
}

async function inferCloseInfo(
  t: typeof trades.$inferSelect,
  _order: BybitOrder | null
): Promise<CloseInfo> {
  const execs = await getRecentExecutions(t.symbol, 50);
  const closingExecs = execs.filter((e) => e.closedSize && Number(e.closedSize) > 0);
  if (closingExecs.length === 0) {
    return { status: "CLOSED_MANUAL", reason: "no closing executions found", exitPrice: null, pnl: null, fees: null };
  }
  const totalPnl = closingExecs.reduce((s, e) => s + Number(e.closedPnl), 0);
  const totalFees = closingExecs.reduce((s, e) => s + Number(e.execFee), 0);
  const avgPrice = closingExecs.reduce((s, e) => s + Number(e.execPrice) * Number(e.execQty), 0) /
    closingExecs.reduce((s, e) => s + Number(e.execQty), 0);

  const tp = Number(t.tpPrice);
  const sl = Number(t.slPrice);
  const tpDist = Math.abs(avgPrice - tp);
  const slDist = Math.abs(avgPrice - sl);
  const liqDetected = closingExecs.some((e) => e.execType?.toLowerCase().includes("liquidation"));

  let status: CloseInfo["status"] = "CLOSED_MANUAL";
  let reason = "manual close";
  if (liqDetected) {
    status = "LIQUIDATED";
    reason = "liquidation";
  } else if (tpDist < slDist && tpDist / tp < 0.005) {
    status = "CLOSED_TP";
    reason = "tp hit";
  } else if (slDist < tpDist && slDist / sl < 0.01) {
    status = "CLOSED_SL";
    reason = "sl hit";
  }

  return {
    status,
    reason,
    exitPrice: String(avgPrice),
    pnl: String(totalPnl),
    fees: String(totalFees),
  };
}

async function accumulateDailyStats(pnl: number): Promise<void> {
  const today = new Date();
  const day = today.toISOString().slice(0, 10);
  await db
    .insert(dailyStats)
    .values({
      day,
      tradesClosed: 1,
      pnlUsdt: String(pnl),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dailyStats.day,
      set: {
        tradesClosed: sql`${dailyStats.tradesClosed} + 1`,
        pnlUsdt: sql`${dailyStats.pnlUsdt} + ${String(pnl)}`,
        updatedAt: new Date(),
      },
    });
}
