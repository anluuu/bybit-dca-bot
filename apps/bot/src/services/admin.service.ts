import { db } from "../db/client.js";
import { orders } from "../db/schema.js";
import { executeDca } from "../strategy.js";
import { notifyFailure } from "../notifications.js";
import { logger } from "../logger.js";
import type { Asset } from "../db/schema.js";

/**
 * Fire-and-forget DCA execution. Returns immediately with the startedAt
 * timestamp; the actual DCA runs asynchronously. Errors are persisted to the
 * DB and surfaced via Telegram so the operator sees them on the dashboard.
 */
export function fireAndForgetDca(asset: Asset): string {
  const startedAt = new Date().toISOString();
  logger.info("Admin triggered run-now DCA", { pair: asset.pair, startedAt });

  // Fire-and-forget: executeDca polls the limit order for minutes, so
  // we can't hold the HTTP connection. Errors are already surfaced via
  // Telegram + DB rows inside the strategy/queue flow.
  void executeDca(asset).catch(async (error) => {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("run-now DCA failed", { pair: asset.pair, error: msg });
    // Parity with worker.on("failed"): persist a failed row so the
    // dashboard shows the attempt, then fire a Telegram alert. Only the
    // worker path gates on attemptsMade; run-now has no retry, so we
    // persist unconditionally.
    try {
      await db.insert(orders).values({
        assetId: asset.id,
        pair: asset.pair,
        orderType: "limit",
        status: "failed",
        errorMessage: msg,
      });
      await notifyFailure(`${msg} (admin run-now)`, asset.pair);
    } catch (inner) {
      logger.error("run-now failure recording also failed", {
        pair: asset.pair,
        error: inner instanceof Error ? inner.message : String(inner),
      });
    }
  });

  return startedAt;
}
