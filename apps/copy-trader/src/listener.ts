import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, NewMessageEvent } from "telegram/events/index.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { parseSignal } from "./domain/parser.js";
import type { SignalIntent } from "./domain/parser.js";
import { db } from "./db/client.js";
import { signals, trades as tradesTable, systemState as ssTable, dailyStats as dsTable } from "./db/schema.js";
import {
  notifySignalParsed,
  notifySignalUnparseable,
} from "./infra/notifications.js";
import { evaluateRiskGate, type GateContext } from "./domain/riskGate.js";
import { executeSignal } from "./domain/executor.js";
import { isSenderAllowed } from "./domain/senderGate.js";
import { getLastPrice, getWalletBalanceUsdt } from "./infra/bybit.js";
import { getAllConfig } from "./infra/configStore.js";
import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";

/**
 * Heuristic for "this message looks like a trading signal." Used to gate
 * the unparseable-signal Telegram notification so casual chat in the channel
 * doesn't generate alert noise. Matches the signaler's typical structural
 * markers; if none are present we skip the alert and only persist the row.
 */
function looksLikeSignal(text: string): boolean {
  return (
    /\b(LONG|SHORT)\b/i.test(text) ||
    /\bEntrada\s*:/i.test(text) ||
    /\bAlavancagem\s*:/i.test(text) ||
    /\bTP\d\s*:/i.test(text) ||
    /\bSL\s*:/i.test(text)
  );
}

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
  const senderId = extractSenderId(msg);
  if (!text || typeof text !== "string") {
    logger.warn("Skipping non-text message", { msgId });
    return;
  }
  if (!isInTargetTopic(msg)) {
    return; // wrong topic; silent to avoid log spam
  }
  await ingestSignalText(text, msgId, senderId);
}

/**
 * When SIGNAL_TOPIC_ID is configured, accept only messages whose reply chain
 * places them inside that forum topic. Telegram represents forum messages
 * with a MessageReplyHeader where either replyToTopId (replies inside the
 * topic) or replyToMsgId (the initial post of the topic) carries the topic's
 * root message id. Unset env = passthrough.
 */
export function isInTargetTopic(msg: { replyTo?: unknown }): boolean {
  if (config.SIGNAL_TOPIC_ID == null) return true;
  const rt = msg.replyTo as
    | { replyToTopId?: number; replyToMsgId?: number; forumTopic?: boolean }
    | undefined;
  if (!rt) return false;
  const top = rt.replyToTopId ?? rt.replyToMsgId;
  return top === config.SIGNAL_TOPIC_ID;
}

/**
 * gramjs surfaces senderId as a BigInteger | undefined depending on whether
 * the message is from a user, a channel, or anonymous. Coerce to a plain
 * number for storage; Telegram user IDs are well within Number.MAX_SAFE_INTEGER.
 */
function extractSenderId(msg: { senderId?: unknown }): number | null {
  const raw = msg.senderId;
  if (raw == null) return null;
  // BigInteger from telegram lib has .toString() / .valueOf()
  const asString = String(raw);
  const n = Number(asString);
  return Number.isFinite(n) ? n : null;
}

async function executeWithGate(intent: SignalIntent, signalId: string): Promise<void> {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const [cfg, stateRows, openCountRows, todayRows] = await Promise.all([
      getAllConfig(),
      db.select().from(ssTable).where(eq(ssTable.id, 1)).limit(1),
      db
        .select({ c: drizzleSql<number>`count(*)::int` })
        .from(tradesTable)
        .where(and(eq(tradesTable.dryRun, false), inArray(tradesTable.status, ["PENDING_FILL", "OPEN"]))),
      db.select().from(dsTable).where(eq(dsTable.day, todayStr)).limit(1),
    ]);

    const state = stateRows[0];
    if (!state) {
      logger.warn("system_state row missing, skipping execute");
      return;
    }

    const openCount = openCountRows[0]?.c ?? 0;
    const initialCapital = Number(state.initialCapital ?? 0);
    const dayPnl = Number(todayRows[0]?.pnlUsdt ?? 0);
    const dayBalanceStart = Number(todayRows[0]?.balanceStart ?? initialCapital);

    const [balanceUsdt, lastPrice] = await Promise.all([
      config.BYBIT_API_KEY
        ? getWalletBalanceUsdt().catch(() => initialCapital)
        : Promise.resolve(initialCapital),
      config.BYBIT_API_KEY
        ? getLastPrice(intent.symbol).catch(() => (intent.entryLow + intent.entryHigh) / 2)
        : Promise.resolve((intent.entryLow + intent.entryHigh) / 2),
    ]);

    const gateCtx: GateContext = {
      config: {
        MAX_OPEN_POSITIONS: Number(cfg.MAX_OPEN_POSITIONS),
        DAILY_LOSS_LIMIT_PCT: Number(cfg.DAILY_LOSS_LIMIT_PCT),
        MAX_DRAWDOWN_PCT: Number(cfg.MAX_DRAWDOWN_PCT),
        CHASE_TOLERANCE_PCT: Number(cfg.CHASE_TOLERANCE_PCT),
        MIN_RR_RATIO: Number(cfg.MIN_RR_RATIO),
        WHITELIST_SYMBOLS: cfg.WHITELIST_SYMBOLS.split(",").map((s) => s.trim()).filter(Boolean),
      },
      state: {
        killed: state.killed,
        killedReason: state.killedReason,
        cooldownUntil: state.cooldownUntil,
        initialCapital,
      },
      balance: balanceUsdt,
      openCount,
      dayPnl,
      dayBalanceStart,
      lastPrice,
      now: new Date(),
    };

    const gate = evaluateRiskGate(intent, gateCtx);

    if (!gate.ok) {
      logger.info("Gate rejected", { signalHash: intent.signalHash, reason: gate.reason });
      return;
    }

    await executeSignal(
      { ...intent, signalId },
      {
        dryRun: cfg.DRY_RUN === "true",
        maxLeverage: Number(cfg.MAX_LEVERAGE),
        maxRiskPct: Number(cfg.MAX_RISK_PCT),
        balanceUsdt,
        lastPrice,
        entryStrategy: gate.entryStrategy,
        limitPrice: gate.limitPrice,
        chaseTimeoutMin: Number(cfg.CHASE_TIMEOUT_MIN),
      }
    );
  } catch (e) {
    logger.error("executeWithGate threw", {
      signalHash: intent.signalHash,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Inserts a row in `signals`. Idempotent against signal_hash unique constraint:
 * if the row already exists we treat it as success (boot reconcile re-runs this
 * function for previously seen messages). Side-effect: Telegram notify on first
 * insert.
 */
export type IngestSignalOptions = {
  execute?: boolean;
  notify?: boolean;
  enforceSenderWhitelist?: boolean;
};

export async function ingestSignalText(
  text: string,
  msgId: number,
  senderId: number | null = null,
  options: IngestSignalOptions = {}
): Promise<void> {
  const execute = options.execute ?? true;
  const notify = options.notify ?? true;
  const enforceSenderWhitelist = options.enforceSenderWhitelist ?? true;
  // Sender whitelist (optional). When the env var is configured, drop messages
  // from anyone not on the list before we even parse — useful when the channel
  // has many members chatting but only one trusted signaler.
  if (
    !isSenderAllowed(config.allowedSenderIds, senderId, enforceSenderWhitelist)
  ) {
    logger.info("Skipping message from non-whitelisted sender", { msgId, senderId });
    return;
  }

  const parsed = parseSignal(text, msgId);

  // Drop messages that neither parse cleanly nor look like signals. The
  // channel mixes signals with casual chat from members — without this gate
  // every "good luck" / "what do you think" line gets persisted as
  // UNPARSEABLE and clutters the dashboard. Real signals still parse OK and
  // signal-shaped failures still go through as UNPARSEABLE (so the operator
  // can see what's broken in the parser).
  if (parsed.kind !== "ok" && !looksLikeSignal(text)) {
    logger.info("Skipping non-signal message", { msgId, reason: parsed.reason });
    return;
  }

  try {
    if (parsed.kind === "ok") {
      const i = parsed.intent;
      const inserted = await db
        .insert(signals)
        .values({
          signalHash: i.signalHash,
          rawText: i.rawText,
          telegramMsgId: i.telegramMsgId,
          telegramSenderId: senderId,
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

      if (notify) {
        void notifySignalParsed({
          direction: i.direction,
          symbol: i.symbol,
          entryLow: i.entryLow,
          entryHigh: i.entryHigh,
          stopLoss: i.stopLoss,
          takeProfit1: i.takeProfit1,
        });
      }
      if (execute) {
        void executeWithGate(i, inserted[0].id);
      }
    } else {
      const inserted = await db
        .insert(signals)
        .values({
          signalHash: parsed.signalHash,
          rawText: parsed.rawText,
          telegramMsgId: parsed.telegramMsgId,
          telegramSenderId: senderId,
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
      // We only reached this branch because the message looked signal-shaped
      // (chat is filtered out by the early-return above).
      if (notify) {
        void notifySignalUnparseable({
          reason: parsed.reason,
          preview: parsed.rawText,
          msgId,
        });
      }
    }
  } catch (error) {
    logger.error("Failed to ingest signal", {
      error: error instanceof Error ? error.message : String(error),
      msgId,
    });
  }
}
