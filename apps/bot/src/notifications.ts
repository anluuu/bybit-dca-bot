import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { logger } from "./logger.js";

let bot: Telegraf;

export function initBot(): Telegraf {
  bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  return bot;
}

/**
 * Boot-time sanity check: confirm TELEGRAM_CHAT_ID resolves. A broken chat id
 * only surfaces today when notifyFailure() fails silently on the way out —
 * i.e. right when the operator most needs to be alerted (see 2026-04-19
 * "chat not found" at 08:10). Logging loudly at boot turns that silent
 * failure into a visible startup warning.
 */
export async function verifyTelegramChat(): Promise<void> {
  try {
    const chat = await bot.telegram.getChat(config.TELEGRAM_CHAT_ID);
    logger.info("Telegram chat verified", {
      chatId: config.TELEGRAM_CHAT_ID,
      type: chat.type,
    });
  } catch (error) {
    logger.error(
      "Telegram chat verification failed — failure alerts will be lost",
      {
        chatId: config.TELEGRAM_CHAT_ID,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

function escapeMarkdown(text: string | null | undefined): string {
  if (text == null) return "";
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

/**
 * Single-exit point for every outbound Telegram message. Wraps both the
 * Telegraf API call AND any synchronous error thrown by the caller's
 * message-building code so a null feeCurrency, a malformed pair string, or
 * any other upstream surprise never bubbles up to the DCA execution path.
 * Past bug: null `feeCurrency` on filled orders caused `escapeMarkdown` to
 * crash inside `notifySuccess`, throwing before `send` was ever invoked —
 * which bypassed this try/catch and killed the caller's await.
 */
async function send(message: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(config.TELEGRAM_CHAT_ID, message, {
      parse_mode: "MarkdownV2",
    });
    logger.info("Telegram notification sent", {
      chatId: config.TELEGRAM_CHAT_ID,
      bytes: message.length,
    });
  } catch (error) {
    logger.error("Telegram notification failed", {
      chatId: config.TELEGRAM_CHAT_ID,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeAsync(fn: () => Promise<void>): Promise<void> {
  return fn().catch((error) => {
    logger.error("Telegram notification builder crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export interface OrderResult {
  pair: string;
  orderType: string;
  price: number;
  quantity: number;
  fiatSpent: number;
  fee: number;
  /** Bybit can omit this on spot orders; be defensive. */
  feeCurrency: string | null | undefined;
}

export function notifySuccess(details: OrderResult): Promise<void> {
  return safeAsync(async () => {
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
    const feeLine = feeCur ? `${fee} ${feeCur}` : fee;

    const msg =
      `*BTC Purchased* \\(${type}\\)\n\n` +
      `*Pair:* ${pair}\n` +
      `*Amount:* ${qty} BTC\n` +
      `*Price:* R\\$${price}\n` +
      `*Spent:* R\\$${spent}\n` +
      `*Fee:* ${feeLine}`;

    await send(msg);
  });
}

export function notifyFailure(error: string, pair: string): Promise<void> {
  return safeAsync(async () => {
    const msg =
      `*DCA FAILED*\n\n` +
      `*Pair:* ${escapeMarkdown(pair)}\n` +
      `*Error:* ${escapeMarkdown(error)}`;
    await send(msg);
  });
}

export function notifyCapReached(
  pair: string,
  spent: number,
  cap: number
): Promise<void> {
  return safeAsync(async () => {
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
  });
}

/**
 * Operator-triggered diagnostic: posts a plain message so a failing
 * integration (wrong chat id, revoked bot token, network block) can be caught
 * without waiting for the next Sunday's DCA to silently drop its alerts.
 */
export function notifyPing(context: string): Promise<void> {
  return safeAsync(async () => {
    const msg =
      `*Telegram Ping*\n\n` +
      `${escapeMarkdown(context)}\n` +
      `Sent at ${escapeMarkdown(new Date().toISOString())}`;
    await send(msg);
  });
}

export function notifyFallback(
  pair: string,
  limitOrderId: string
): Promise<void> {
  return safeAsync(async () => {
    const msg =
      `*Limit Order Expired*\n\n` +
      `*Pair:* ${escapeMarkdown(pair)}\n` +
      `*Order:* ${escapeMarkdown(limitOrderId)}\n` +
      `Placing market order as fallback\\.`;
    await send(msg);
  });
}

export function notifyTransfer(
  amount: number,
  coin: string,
  transferId: string
): Promise<void> {
  return safeAsync(async () => {
    const amountStr = escapeMarkdown(
      amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const coinStr = escapeMarkdown(coin);
    const idStr = escapeMarkdown(transferId);
    const msg =
      `*Funds Topped Up*\n\n` +
      `*Amount:* ${amountStr} ${coinStr}\n` +
      `*Direction:* Funding → Spot\n` +
      `*Transfer ID:* ${idStr}`;
    await send(msg);
  });
}

export function notifyInsufficientFunds(
  pair: string,
  available: number,
  required: number,
  coin: string
): Promise<void> {
  return safeAsync(async () => {
    const pairStr = escapeMarkdown(pair);
    const coinStr = escapeMarkdown(coin);
    const availStr = escapeMarkdown(
      available.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const reqStr = escapeMarkdown(
      required.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    const msg =
      `*⚠️ INSUFFICIENT FUNDS*\n\n` +
      `*Pair:* ${pairStr}\n` +
      `*Available:* ${availStr} ${coinStr} \\(Spot \\+ Funding\\)\n` +
      `*Required:* ${reqStr} ${coinStr}\n\n` +
      `Deposit ${coinStr} to Bybit and retry via *Run now*\\.`;
    await send(msg);
  });
}
