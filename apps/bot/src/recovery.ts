import { eq, and, isNotNull, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { orders } from "./db/schema.js";
import { getOrderDetail, ExchangeClientError } from "./infra/exchange.js";
import { notifySuccess } from "./infra/notifications.js";
import { logger } from "./logger.js";

/**
 * Reconcile rows stuck in `pending` that the process is no longer polling.
 *
 * `executeDca` and `executeTestOrder` each run their polling loop inside the
 * Node process that placed the order. If the process dies mid-flight (deploy,
 * OOM, crash) the DB row stays `pending` forever even though the order was
 * placed on Bybit and may already have filled — we saw this 2026-04-19 when
 * a tz fix redeploy interrupted the admin run-now polling. This sweep runs
 * at boot, asks Bybit for the current status of every `pending` row with a
 * known `bybitOrderId`, and advances the row to its true terminal state.
 *
 * Only reads Bybit + writes DB. Does not place new orders, does not call the
 * market-fallback path — a stuck `pending` that never filled will just get
 * updated to `cancelled` on Bybit (or stay pending if Bybit still has it
 * open); placing a new buy here would risk double-spends and belongs in an
 * explicit operator action.
 */
export async function reconcilePendingOrders(): Promise<void> {
  const stuck = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        isNotNull(orders.bybitOrderId)
      )
    );

  if (stuck.length === 0) return;

  logger.info("Reconciling stuck pending orders", { count: stuck.length });

  for (const row of stuck) {
    const orderId = row.bybitOrderId;
    if (!orderId) continue;

    try {
      const detail = await getOrderDetail(row.pair, orderId);

      if (detail.orderStatus === "Filled") {
        const cumExecValue = parseFloat(detail.cumExecValue);
        await db
          .update(orders)
          .set({
            status: "filled",
            price: detail.avgPrice,
            quantity: detail.cumExecQty,
            fiatSpent: isFinite(cumExecValue) ? cumExecValue.toFixed(2) : null,
            fee: detail.cumExecFee,
            feeCurrency: detail.feeCurrency,
          })
          .where(eq(orders.id, row.id));

        logger.info("Reconciled filled order", {
          orderId,
          pair: row.pair,
          avgPrice: detail.avgPrice,
        });

        if (!row.isTest) {
          await notifySuccess({
            pair: row.pair,
            orderType: row.orderType,
            price: parseFloat(detail.avgPrice),
            quantity: parseFloat(detail.cumExecQty),
            fiatSpent: cumExecValue,
            fee: parseFloat(detail.cumExecFee),
            feeCurrency: detail.feeCurrency,
          });
        }
        continue;
      }

      if (
        detail.orderStatus === "PartiallyFilledCanceled" &&
        parseFloat(detail.cumExecQty) > 0
      ) {
        const cumExecValue = parseFloat(detail.cumExecValue);
        await db
          .update(orders)
          .set({
            status: "filled",
            price: detail.avgPrice,
            quantity: detail.cumExecQty,
            fiatSpent: isFinite(cumExecValue) ? cumExecValue.toFixed(2) : null,
            fee: detail.cumExecFee,
            feeCurrency: detail.feeCurrency,
          })
          .where(eq(orders.id, row.id));

        logger.info("Reconciled partially-filled canceled order", {
          orderId,
          pair: row.pair,
        });
        continue;
      }

      if (
        detail.orderStatus === "Cancelled" ||
        detail.orderStatus === "Rejected" ||
        detail.orderStatus === "PartiallyFilledCanceled"
      ) {
        await db
          .update(orders)
          .set({
            status: "cancelled",
            errorMessage: `Reconciled from Bybit status=${detail.orderStatus}`,
          })
          .where(eq(orders.id, row.id));
        logger.warn("Reconciled cancelled/rejected order", {
          orderId,
          pair: row.pair,
          bybitStatus: detail.orderStatus,
        });
        continue;
      }

      logger.info("Order still open on Bybit, leaving pending", {
        orderId,
        pair: row.pair,
        bybitStatus: detail.orderStatus,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof ExchangeClientError) {
        // Bybit doesn't know about this order anymore (purged/invalid id).
        // Mark cancelled with the error so it stops blocking busyReason.
        await db
          .update(orders)
          .set({
            status: "cancelled",
            errorMessage: `Reconcile failed: ${msg}`,
          })
          .where(eq(orders.id, row.id));
        logger.warn("Reconcile could not find order, marked cancelled", {
          orderId,
          pair: row.pair,
          error: msg,
        });
        continue;
      }
      logger.error("Reconcile failed for order", {
        orderId,
        pair: row.pair,
        error: msg,
      });
    }
  }
}

/**
 * Null-safe reconcile for bulk status filter. Exposed for future admin
 * endpoint callers that want to trigger this on demand.
 */
export async function countPendingOrders(): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<string>`COUNT(*)` })
    .from(orders)
    .where(eq(orders.status, "pending"));
  return parseInt(total, 10);
}
