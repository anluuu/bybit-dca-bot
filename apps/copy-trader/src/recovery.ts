import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { ingestSignalText } from "./listener.js";

/**
 * Read the most recent `BOOT_RECONCILE_LIMIT` messages from the signal channel
 * and replay them through ingestSignalText. The signal_hash UNIQUE constraint
 * means already-seen messages no-op at insert time.
 *
 * Channel id format: SIGNAL_CHANNEL_ID is the raw chat id (negative for
 * channels). gramjs accepts the numeric id directly.
 */
export async function reconcileRecentMessages(client: TelegramClient): Promise<void> {
  const limit = config.BOOT_RECONCILE_LIMIT;
  if (limit === 0) {
    logger.info("Boot reconcile skipped (BOOT_RECONCILE_LIMIT=0)");
    return;
  }

  logger.info("Boot reconcile starting", { limit });
  try {
    const messages = await client.getMessages(config.SIGNAL_CHANNEL_ID, { limit });
    const ingestable = messages.filter(
      (msg): msg is Api.Message =>
        msg instanceof Api.Message && typeof msg.message === "string" && msg.message.length > 0
    );
    await Promise.allSettled(
      ingestable.map((msg) => ingestSignalText(msg.message, msg.id))
    );
    logger.info("Boot reconcile complete", { fetched: messages.length, processed: ingestable.length });
  } catch (error) {
    logger.error("Boot reconcile failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
