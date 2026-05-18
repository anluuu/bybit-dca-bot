import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { ingestSignalText, isInTargetTopic } from "./listener.js";

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
    // Fetch the most recent N messages from the channel as a flat list. The
    // per-message topic / sender filters in ingestSignalText drop anything
    // that isn't in the right thread or from the right author, so we don't
    // need to scope the fetch (and gramjs's replyTo filter for forum topics
    // returns MSG_ID_INVALID against this channel — safer to filter
    // client-side).
    const messages = await client.getMessages(config.SIGNAL_CHANNEL_ID, { limit });
    const ingestable = messages.filter(
      (msg): msg is Api.Message =>
        msg instanceof Api.Message &&
        typeof msg.message === "string" &&
        msg.message.length > 0 &&
        isInTargetTopic(msg)
    );
    await Promise.allSettled(
      ingestable.map((msg) => {
        const senderId = msg.senderId ? Number(String(msg.senderId)) : null;
        return ingestSignalText(
          msg.message,
          msg.id,
          Number.isFinite(senderId as number) ? (senderId as number) : null
        );
      })
    );
    logger.info("Boot reconcile complete", { fetched: messages.length, processed: ingestable.length });
  } catch (error) {
    logger.error("Boot reconcile failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
