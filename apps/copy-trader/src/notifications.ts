import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { logger } from "./logger.js";

let bot: Telegraf | null = null;

export function initNotifier(): Telegraf {
  bot = new Telegraf(config.TELEGRAM_NOTIFY_BOT_TOKEN);
  return bot;
}

export async function verifyChat(): Promise<void> {
  if (!bot) throw new Error("Notifier not initialized");
  try {
    const chat = await bot.telegram.getChat(config.TELEGRAM_NOTIFY_CHAT_ID);
    logger.info("Notifier chat verified", { chatId: config.TELEGRAM_NOTIFY_CHAT_ID, type: chat.type });
  } catch (error) {
    logger.error("Notifier chat verification failed", {
      chatId: config.TELEGRAM_NOTIFY_CHAT_ID,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function escapeMd(text: string | null | undefined): string {
  if (text == null) return "";
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function send(
  message: string,
  opts: { plain?: boolean } = {}
): Promise<void> {
  if (!bot) {
    logger.warn("send() before initNotifier(); dropping message");
    return;
  }
  try {
    await bot.telegram.sendMessage(
      config.TELEGRAM_NOTIFY_CHAT_ID,
      message,
      opts.plain ? undefined : { parse_mode: "MarkdownV2" }
    );
  } catch (error) {
    logger.error("Notification send failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeAsync(fn: () => Promise<void>): Promise<void> {
  return fn().catch((error) =>
    logger.error("Notification builder crashed", {
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

export function notifySignalParsed(args: {
  direction: string;
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
}): Promise<void> {
  return safeAsync(async () => {
    const body =
      `*Signal parsed*\n\n` +
      `*${escapeMd(args.direction)}* ${escapeMd(args.symbol)}\n` +
      `Entry: ${escapeMd(String(args.entryLow))}–${escapeMd(String(args.entryHigh))}\n` +
      `SL: ${escapeMd(String(args.stopLoss))}\n` +
      `TP1: ${escapeMd(String(args.takeProfit1))}`;
    await send(body);
  });
}

export function notifySignalUnparseable(args: {
  reason: string;
  preview: string;
  msgId: number;
}): Promise<void> {
  return safeAsync(async () => {
    // Plain text (no parse_mode) — the raw signal body can contain any
    // character the signaler types and MarkdownV2 escape rules are too brittle
    // to round-trip cleanly inside code fences. This is an operator-diagnostic
    // notification, so formatting doesn't matter.
    const body =
      `⚠️ Unparseable signal\n\n` +
      `Reason: ${args.reason}\n` +
      `Msg id: ${args.msgId}\n\n` +
      args.preview.slice(0, 300);
    await send(body, { plain: true });
  });
}

export function notifyLifecycle(stage: string, detail?: string): Promise<void> {
  return safeAsync(async () => {
    // Plain text — "copy-trader" itself contains a hyphen which is reserved
    // in MarkdownV2, and operator lifecycle pings don't need formatting.
    const body = `copy-trader ${stage}` + (detail ? `\n${detail}` : "");
    await send(body, { plain: true });
  });
}
