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

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function send(message: string): Promise<void> {
  if (!bot) {
    logger.warn("send() before initNotifier(); dropping message");
    return;
  }
  try {
    await bot.telegram.sendMessage(config.TELEGRAM_NOTIFY_CHAT_ID, message, {
      parse_mode: "MarkdownV2",
    });
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
    const body =
      `*⚠️ Unparseable signal*\n\n` +
      `Reason: ${escapeMd(args.reason)}\n` +
      `Msg id: ${escapeMd(String(args.msgId))}\n\n` +
      `\`\`\`\n${args.preview.slice(0, 300)}\n\`\`\``;
    await send(body);
  });
}

export function notifyLifecycle(stage: string, detail?: string): Promise<void> {
  return safeAsync(async () => {
    const body = `*copy-trader ${escapeMd(stage)}*` + (detail ? `\n${escapeMd(detail)}` : "");
    await send(body);
  });
}
