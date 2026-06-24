import { db } from "../db/client.js";
import { trades, signals } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";
import {
  createOrder,
  setLeverage,
  setMarginModeIsolated,
  ExchangeApiError,
  ExchangeClientError,
} from "../infra/bybit.js";
import { getInstrumentSpec, type InstrumentSpec } from "../infra/instrumentInfo.js";
import { computePositionPlan } from "./sizing.js";

export type ExecutorSignal = {
  signalId: string;
  signalHash: string;
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  leverageRaw: number;
};

export type ExecuteOptions = {
  dryRun: boolean;
  maxLeverage: number;
  maxRiskPct: number;
  balanceUsdt: number;
  lastPrice: number;
  entryStrategy: "MARKET" | "LIMIT_CHASE";
  limitPrice?: number;
  chaseTimeoutMin?: number;
  instrumentOverride?: InstrumentSpec;
};

export async function executeSignal(
  signal: ExecutorSignal,
  opts: ExecuteOptions
): Promise<void> {
  const leverageUsed = Math.min(signal.leverageRaw, opts.maxLeverage);
  const instrument = opts.instrumentOverride ?? (await getInstrumentSpec(signal.symbol));

  const entryPrice =
    opts.entryStrategy === "LIMIT_CHASE" && opts.limitPrice != null
      ? opts.limitPrice
      : opts.lastPrice;

  const plan = computePositionPlan({
    balanceUsdt: opts.balanceUsdt,
    maxRiskPct: opts.maxRiskPct,
    direction: signal.direction,
    entryPrice,
    stopLoss: signal.stopLoss,
    leverageUsed,
    instrument,
  });

  if (plan.kind !== "ok") {
    await insertErrorTrade(signal, leverageUsed, plan.reason, opts.dryRun);
    logger.warn("Executor skipped — sizing error", {
      signalHash: signal.signalHash,
      reason: plan.reason,
    });
    return;
  }

  const orderLinkId = `copy-${signal.signalHash.slice(0, 16)}`;
  const limitExpiresAt =
    opts.entryStrategy === "LIMIT_CHASE" && opts.chaseTimeoutMin
      ? new Date(Date.now() + opts.chaseTimeoutMin * 60_000)
      : null;

  if (opts.dryRun) {
    const inserted = await db
      .insert(trades)
      .values({
        signalId: signal.signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        bybitOrderId: null,
        bybitOrderLinkId: orderLinkId,
        plannedQty: String(plan.qty),
        plannedMargin: String(plan.marginUsdt),
        leverageUsed,
        entryStrategy: opts.entryStrategy,
        limitPrice:
          opts.entryStrategy === "LIMIT_CHASE"
            ? String(opts.limitPrice ?? entryPrice)
            : null,
        limitExpiresAt,
        tpPrice: String(signal.takeProfit1),
        slPrice: String(signal.stopLoss),
        status: "DRY_RUN_LOGGED",
        dryRun: true,
      })
      .returning({ id: trades.id });
    await db
      .update(signals)
      .set({ tradeId: inserted[0].id, status: "EXECUTED" })
      .where(eq(signals.id, signal.signalId));
    logger.info("Dry-run logged", {
      signalHash: signal.signalHash,
      qty: plan.qty,
      leverageUsed,
      entryStrategy: opts.entryStrategy,
    });
    return;
  }

  // Live branch
  try {
    await setMarginModeIsolated(signal.symbol, leverageUsed);
    await setLeverage(signal.symbol, leverageUsed);
    const order = await createOrder({
      symbol: signal.symbol,
      side: signal.direction === "LONG" ? "Buy" : "Sell",
      orderType: opts.entryStrategy === "MARKET" ? "Market" : "Limit",
      qty: String(plan.qty),
      price:
        opts.entryStrategy === "LIMIT_CHASE"
          ? String(opts.limitPrice ?? entryPrice)
          : undefined,
      takeProfit: String(signal.takeProfit1),
      stopLoss: String(signal.stopLoss),
      orderLinkId,
    });
    const inserted = await db
      .insert(trades)
      .values({
        signalId: signal.signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        bybitOrderId: order.orderId,
        bybitOrderLinkId: orderLinkId,
        plannedQty: String(plan.qty),
        plannedMargin: String(plan.marginUsdt),
        leverageUsed,
        entryStrategy: opts.entryStrategy,
        limitPrice:
          opts.entryStrategy === "LIMIT_CHASE"
            ? String(opts.limitPrice ?? entryPrice)
            : null,
        limitExpiresAt,
        tpPrice: String(signal.takeProfit1),
        slPrice: String(signal.stopLoss),
        status: "PENDING_FILL",
        dryRun: false,
      })
      .returning({ id: trades.id });
    await db
      .update(signals)
      .set({ tradeId: inserted[0].id, status: "EXECUTED" })
      .where(eq(signals.id, signal.signalId));
    logger.info("Live order placed", {
      signalHash: signal.signalHash,
      bybitOrderId: order.orderId,
      qty: plan.qty,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await insertErrorTrade(signal, leverageUsed, message, false);
    logger.error("Executor failed", {
      signalHash: signal.signalHash,
      error: message,
    });
  }
}

async function insertErrorTrade(
  signal: ExecutorSignal,
  leverageUsed: number,
  errorMessage: string,
  dryRun: boolean
): Promise<void> {
  const inserted = await db
    .insert(trades)
    .values({
      signalId: signal.signalId,
      symbol: signal.symbol,
      direction: signal.direction,
      bybitOrderLinkId: `copy-err-${signal.signalHash.slice(0, 10)}-${Date.now()}`,
      plannedQty: "0",
      plannedMargin: "0",
      leverageUsed,
      entryStrategy: "MARKET",
      tpPrice: String(signal.takeProfit1),
      slPrice: String(signal.stopLoss),
      status: "ERROR",
      errorMessage,
      dryRun,
    })
    .returning({ id: trades.id });
  await db
    .update(signals)
    .set({ tradeId: inserted[0].id, status: "EXECUTED" })
    .where(eq(signals.id, signal.signalId));
}
