import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, NewMessageEvent } from "telegram/events/index.js";
import { Api } from "telegram";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { parseSignal } from "./parser.js";
import { db } from "./db/client.js";
import { signals } from "./db/schema.js";
import {
  notifySignalParsed,
  notifySignalUnparseable,
} from "./notifications.js";

let client: TelegramClient | null = null;

export async function startListener(): Promise<TelegramClient> {
  client = new TelegramClient(
    new StringSession(config.TELEGRAM_SESSION_STRING),
    config.TELEGRAM_API_ID,
    config.TELEGRAM_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();
  if (!(await client.checkAuthorization())) {
    throw new Error("Telegram session not authorized — regenerate via `pnpm auth`");
  }

  logger.info("Telegram listener connected");

  client.addEventHandler(handleEvent, new NewMessage({ chats: [config.SIGNAL_CHANNEL_ID] }));

  return client;
}

export async function stopListener(): Promise<void> {
  if (!client) return;
  await client.disconnect();
  client = null;
  logger.info("Telegram listener disconnected");
}

async function handleEvent(event: NewMessageEvent): Promise<void> {
  const msg = event.message;
  const text = msg.message;
  const msgId = msg.id;
  if (!text || typeof text !== "string") {
    logger.warn("Skipping non-text message", { msgId });
    return;
  }
  await ingestSignalText(text, msgId);
}

/**
 * Inserts a row in `signals`. Idempotent against signal_hash unique constraint:
 * if the row already exists we treat it as success (boot reconcile re-runs this
 * function for previously seen messages). Side-effect: Telegram notify on first
 * insert.
 */
export async function ingestSignalText(text: string, msgId: number): Promise<void> {
  const parsed = parseSignal(text, msgId);

  try {
    if (parsed.kind === "ok") {
      const i = parsed.intent;
      const inserted = await db
        .insert(signals)
        .values({
          signalHash: i.signalHash,
          rawText: i.rawText,
          telegramMsgId: i.telegramMsgId,
          direction: i.direction,
          symbol: i.symbol,
          entryLow: String(i.entryLow),
          entryHigh: String(i.entryHigh),
          stopLoss: String(i.stopLoss),
          leverageRaw: i.leverageRaw,
          takeProfit1: String(i.takeProfit1),
          takeProfit2: i.takeProfit2 !== undefined ? String(i.takeProfit2) : null,
          takeProfit3: i.takeProfit3 !== undefined ? String(i.takeProfit3) : null,
          status: "PARSED",
        })
        .onConflictDoNothing({ target: signals.signalHash })
        .returning({ id: signals.id });

      if (inserted.length === 0) {
        logger.info("Signal already seen, skipping notify", { signalHash: i.signalHash, msgId });
        return;
      }

      logger.info("Signal ingested", {
        signalId: inserted[0].id,
        direction: i.direction,
        symbol: i.symbol,
        msgId,
      });

      void notifySignalParsed({
        direction: i.direction,
        symbol: i.symbol,
        entryLow: i.entryLow,
        entryHigh: i.entryHigh,
        stopLoss: i.stopLoss,
        takeProfit1: i.takeProfit1,
      });
    } else {
      const inserted = await db
        .insert(signals)
        .values({
          signalHash: parsed.signalHash,
          rawText: parsed.rawText,
          telegramMsgId: parsed.telegramMsgId,
          status: "UNPARSEABLE",
          skipReason: parsed.reason,
        })
        .onConflictDoNothing({ target: signals.signalHash })
        .returning({ id: signals.id });

      if (inserted.length === 0) {
        logger.info("Signal already seen, skipping notify", { signalHash: parsed.signalHash, msgId });
        return;
      }

      logger.warn("Signal unparseable", { reason: parsed.reason, msgId });
      void notifySignalUnparseable({
        reason: parsed.reason,
        preview: parsed.rawText,
        msgId,
      });
    }
  } catch (error) {
    logger.error("Failed to ingest signal", {
      error: error instanceof Error ? error.message : String(error),
      msgId,
    });
  }
}

export function getClient(): TelegramClient | null {
  return client;
}

// Re-export Api so callers can construct InputPeerChannel etc.
export { Api };
