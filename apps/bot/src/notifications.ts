import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { logger } from "./logger.js";

let bot: Telegraf;

export function initBot(): Telegraf {
  bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  return bot;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function send(message: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, message, {
      parse_mode: "MarkdownV2",
    });
  } catch (error) {
    logger.error("Telegram notification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface OrderResult {
  pair: string;
  orderType: string;
  price: number;
  quantity: number;
  fiatSpent: number;
  fee: number;
  feeCurrency: string;
  /**
   * Applied signal multiplier. 1.0 means either the feature flag is off or
   * the composite landed exactly neutral. We surface it only when it's
   * meaningfully off 1.0 so typical flat buys stay terse.
   */
  multiplier: number;
}

export async function notifySuccess(details: OrderResult): Promise<void> {
  const pair = escapeMarkdown(details.pair);
  const qty = escapeMarkdown(details.quantity.toFixed(8));
  const price = escapeMarkdown(
    details.price.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
  const spent = escapeMarkdown(
    details.fiatSpent.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
  const fee = escapeMarkdown(details.fee.toFixed(8));
  const feeCur = escapeMarkdown(details.feeCurrency);
  const type = escapeMarkdown(details.orderType.toUpperCase());

  // Only surface the multiplier line when the bot actually modulated the buy
  // — avoids noisy 1.00× stamps on every flat DCA.
  const multiplierLine =
    Math.abs(details.multiplier - 1) > 0.01
      ? `\n*Multiplier:* ${escapeMarkdown(details.multiplier.toFixed(2))}x`
      : "";

  const msg =
    `*BTC Purchased* \\(${type}\\)\n\n` +
    `*Pair:* ${pair}\n` +
    `*Amount:* ${qty} BTC\n` +
    `*Price:* R\\$${price}\n` +
    `*Spent:* R\\$${spent}\n` +
    `*Fee:* ${fee} ${feeCur}` +
    multiplierLine;

  await send(msg);
}

export async function notifyFailure(
  error: string,
  pair: string
): Promise<void> {
  const msg =
    `*DCA FAILED*\n\n` +
    `*Pair:* ${escapeMarkdown(pair)}\n` +
    `*Error:* ${escapeMarkdown(error)}`;

  await send(msg);
}

export async function notifyCapReached(
  pair: string,
  spent: number,
  cap: number
): Promise<void> {
  const spentStr = escapeMarkdown(
    spent.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
  const capStr = escapeMarkdown(
    cap.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );

  const msg =
    `*Monthly Cap Reached*\n\n` +
    `*Pair:* ${escapeMarkdown(pair)}\n` +
    `*Spent:* R\\$${spentStr} / R\\$${capStr}\n` +
    `Skipping this week\\.`;

  await send(msg);
}

export async function notifyFallback(
  pair: string,
  limitOrderId: string
): Promise<void> {
  const msg =
    `*Limit Order Expired*\n\n` +
    `*Pair:* ${escapeMarkdown(pair)}\n` +
    `*Order:* ${escapeMarkdown(limitOrderId)}\n` +
    `Placing market order as fallback\\.`;

  await send(msg);
}
