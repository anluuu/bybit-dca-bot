import { UnrecoverableError } from "bullmq";
import { db } from "./db/client.js";
import { orders, type Asset, type Order } from "./db/schema.js";
import { eq } from "drizzle-orm";
import {
  getTickerPrice,
  placeLimitOrder,
  placeMarketOrder,
  cancelOrder,
  getOrderDetail,
  ExchangeClientError,
  ExchangeApiError,
  type OrderDetail,
} from "./exchange.js";
import { getMonthlySpent } from "./spending.js";
import {
  notifySuccess,
  notifyFailure,
  notifyCapReached,
  notifyFallback,
} from "./notifications.js";
import { getCompositeSignal, type CompositeSignal } from "./signals/compose.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOrderFill(
  pair: string,
  orderId: string,
  maxAttempts: number,
  delayMs: number
): Promise<OrderDetail> {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(delayMs);
    const detail = await getOrderDetail(pair, orderId);
    if (
      detail.orderStatus === "Filled" ||
      detail.orderStatus === "PartiallyFilledCanceled"
    ) {
      return detail;
    }
    if (
      detail.orderStatus === "Cancelled" ||
      detail.orderStatus === "Rejected"
    ) {
      return detail;
    }
  }
  return getOrderDetail(pair, orderId);
}

function recordOrderResult(
  detail: OrderDetail,
  pair: string,
  orderType: string,
  multiplier: number
) {
  return {
    pair,
    orderType,
    price: parseFloat(detail.avgPrice),
    quantity: parseFloat(detail.cumExecQty),
    fiatSpent: parseFloat(detail.cumExecValue),
    fee: parseFloat(detail.cumExecFee),
    feeCurrency: detail.feeCurrency,
    multiplier,
  };
}

/**
 * Project a CompositeSignal (+ applied multiplier) into the Drizzle-insertable
 * columns added by migration 0002. `appliedMultiplier` is explicit because the
 * multiplier stored on the row is what we actually used — which may differ
 * from `signal.multiplier` if modulation is disabled via feature flag (stored
 * as 1.00) or if the cap clamp reduced it.
 */
function signalColumns(signal: CompositeSignal, appliedMultiplier: number) {
  return {
    mayerMultiple: signal.mayer ? signal.mayer.multiple.toFixed(4) : null,
    ma200wDistancePct: signal.ma200w
      ? signal.ma200w.distancePct.toFixed(4)
      : null,
    fearGreedIndex: signal.fearGreed ? signal.fearGreed.value : null,
    compositeScore: signal.composite.toFixed(4),
    appliedMultiplier: appliedMultiplier.toFixed(2),
    signalFallback: signal.fallback,
  };
}

export async function executeDca(asset: Asset): Promise<void> {
  const { pair, id: assetId } = asset;
  const buyAmount = parseFloat(asset.buyAmount);
  const monthlyCap = parseFloat(asset.monthlyCap);
  const limitDiscount = parseFloat(asset.limitDiscount);
  const limitWaitMins = asset.limitWaitMins;

  logger.info("Starting DCA execution", { pair, buyAmount });

  // 1. Check monthly spending cap (using the baseline buyAmount to avoid
  // skipping a week just because the modulation could have gone high). The
  // signal clamp below is what actually governs spend.
  const spent = await getMonthlySpent(pair);
  const remaining = monthlyCap - spent;
  if (remaining < config.MIN_ORDER_BRL) {
    logger.info("Monthly cap reached, skipping", { pair, spent, monthlyCap });

    await db.insert(orders).values({
      assetId,
      pair,
      orderType: "limit",
      status: "skipped_cap",
    });

    await notifyCapReached(pair, spent, monthlyCap);
    return;
  }

  // 2. Capture signals BEFORE placing the order. Signals are always captured
  // (for historical analysis on order rows); whether they actually modulate
  // the buy amount is gated by SIGNAL_MODULATION_ENABLED.
  const signal = await getCompositeSignal(pair);

  // 3. Compute effective buy amount.
  //   - modulation disabled  → effective = buyAmount (legacy flat behavior)
  //   - modulation enabled   → effective = buyAmount × multiplier, clamped
  //                             to remaining monthly cap
  const candidateAmount = config.SIGNAL_MODULATION_ENABLED
    ? buyAmount * signal.multiplier
    : buyAmount;
  const effectiveAmount = Math.min(candidateAmount, remaining);
  const clampedByCap = effectiveAmount < candidateAmount;
  // The multiplier we actually applied (may be < signal.multiplier if clamped,
  // or 1.0 if the feature flag is off).
  const appliedMultiplier = effectiveAmount / buyAmount;

  logger.info("Signal-aware DCA plan", {
    pair,
    baseBuyAmount: buyAmount,
    signalMultiplier: signal.multiplier,
    candidateAmount,
    effectiveAmount,
    monthlyRemaining: remaining,
    cappedFromMultiplier: clampedByCap,
    fallback: signal.fallback,
    modulationEnabled: config.SIGNAL_MODULATION_ENABLED,
  });

  if (effectiveAmount < config.MIN_ORDER_BRL) {
    logger.info("Effective buy below min order size, skipping", {
      pair,
      effectiveAmount,
      minOrder: config.MIN_ORDER_BRL,
    });

    await db.insert(orders).values({
      assetId,
      pair,
      orderType: "limit",
      status: "skipped_min_order",
      ...signalColumns(signal, appliedMultiplier),
    });
    return;
  }

  // 4. Fetch current price (used for the limit price calculation).
  let currentPrice: number;
  try {
    currentPrice = await getTickerPrice(pair);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 5. Calculate limit order params from effectiveAmount (not buyAmount).
  const limitPrice = currentPrice * (1 - limitDiscount / 100);
  const quantity = effectiveAmount / limitPrice;

  // Round price to 2 decimals, quantity to 6 decimals (Bybit BTC/BRL typical)
  const priceStr = limitPrice.toFixed(2);
  const qtyStr = quantity.toFixed(6);

  // 6. Place limit order
  let limitOrderId: string;
  try {
    limitOrderId = await placeLimitOrder(pair, qtyStr, priceStr);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 7. Record pending order (with signal snapshot so it's visible even while
  //    the order is mid-flight).
  const [insertedOrder] = await db
    .insert(orders)
    .values({
      assetId,
      pair,
      orderType: "limit",
      bybitOrderId: limitOrderId,
      status: "pending",
      ...signalColumns(signal, appliedMultiplier),
    })
    .returning({ id: orders.id });

  // 6. Poll for limit order fill
  const pollIntervalMs = 30_000;
  const maxPolls = Math.ceil((limitWaitMins * 60_000) / pollIntervalMs);

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollIntervalMs);

    const detail = await getOrderDetail(pair, limitOrderId);

    if (detail.orderStatus === "Filled") {
      await db
        .update(orders)
        .set({
          status: "filled",
          price: detail.avgPrice,
          quantity: detail.cumExecQty,
          fiatSpent: parseFloat(detail.cumExecValue).toFixed(2),
          fee: detail.cumExecFee,
          feeCurrency: detail.feeCurrency,
        })
        .where(eq(orders.id, insertedOrder.id));

      await notifySuccess(
        recordOrderResult(detail, pair, "limit", appliedMultiplier)
      );
      logger.info("Limit order filled", { pair, orderId: limitOrderId });
      return;
    }

    // Handle external cancellation or rejection
    if (
      detail.orderStatus === "Cancelled" ||
      detail.orderStatus === "Rejected" ||
      detail.orderStatus === "PartiallyFilledCanceled"
    ) {
      logger.warn("Limit order ended externally", {
        pair,
        orderId: limitOrderId,
        status: detail.orderStatus,
      });

      await db
        .update(orders)
        .set({ status: "cancelled" })
        .where(eq(orders.id, insertedOrder.id));

      break;
    }

    logger.info("Polling limit order", {
      pair,
      orderId: limitOrderId,
      poll: i + 1,
      maxPolls,
      status: detail.orderStatus,
    });
  }

  // 7. Limit order not filled — cancel and fallback to market
  logger.info("Limit order not filled, falling back to market", {
    pair,
    orderId: limitOrderId,
  });

  try {
    await cancelOrder(pair, limitOrderId);
  } catch {
    logger.warn("Cancel order failed (may already be cancelled)", {
      pair,
      orderId: limitOrderId,
    });
  }

  // Update limit order row if still pending (timeout case)
  await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(eq(orders.id, insertedOrder.id));

  await notifyFallback(pair, limitOrderId);

  // 8. Place market order using the SAME effectiveAmount the limit order used,
  //    so the modulation decision propagates end-to-end.
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrder(pair, effectiveAmount.toFixed(2));
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 9. Poll market order with retries (not just a single sleep)
  const marketDetail = await waitForOrderFill(pair, marketOrderId, 5, 2_000);

  const isFilled =
    marketDetail.orderStatus === "Filled" ||
    (marketDetail.orderStatus === "PartiallyFilledCanceled" &&
      parseFloat(marketDetail.cumExecQty) > 0);

  await db.insert(orders).values({
    assetId,
    pair,
    orderType: "market",
    bybitOrderId: marketOrderId,
    status: isFilled ? "filled" : "failed",
    price: marketDetail.avgPrice,
    quantity: marketDetail.cumExecQty,
    fiatSpent: parseFloat(marketDetail.cumExecValue).toFixed(2),
    fee: marketDetail.cumExecFee,
    feeCurrency: marketDetail.feeCurrency,
    ...signalColumns(signal, appliedMultiplier),
  });

  if (isFilled) {
    await notifySuccess(
      recordOrderResult(marketDetail, pair, "market", appliedMultiplier)
    );
    logger.info("Market fallback order filled", {
      pair,
      orderId: marketOrderId,
    });
  } else {
    const errorMsg = `Market order not filled: orderStatus=${marketDetail.orderStatus}`;
    await notifyFailure(errorMsg, pair);
    throw new Error(errorMsg);
  }
}

/**
 * Execute a small *test* market order. Tagged is_test=true so it's excluded
 * from monthly-cap accounting and public/admin summary aggregates. Does NOT
 * send Telegram notifications — this is an admin-triggered sanity check, not
 * a real DCA event.
 *
 * Always uses a market order (no limit fallback) so feedback is immediate.
 * The caller is expected to have already checked for in-flight orders on the
 * same pair.
 */
export async function executeTestOrder(
  asset: Asset,
  amountBrl: number
): Promise<Order> {
  const { pair, id: assetId } = asset;
  logger.info("Starting test order", { pair, amountBrl });

  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrder(pair, amountBrl.toFixed(2));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [failedRow] = await db
      .insert(orders)
      .values({
        assetId,
        pair,
        orderType: "market",
        status: "failed",
        errorMessage: msg,
        isTest: true,
      })
      .returning();

    if (
      error instanceof ExchangeClientError ||
      error instanceof ExchangeApiError
    ) {
      return failedRow;
    }
    throw error;
  }

  const detail = await waitForOrderFill(pair, marketOrderId, 5, 2_000);

  const isFilled =
    detail.orderStatus === "Filled" ||
    (detail.orderStatus === "PartiallyFilledCanceled" &&
      parseFloat(detail.cumExecQty) > 0);

  const [row] = await db
    .insert(orders)
    .values({
      assetId,
      pair,
      orderType: "market",
      bybitOrderId: marketOrderId,
      status: isFilled ? "filled" : "failed",
      price: detail.avgPrice,
      quantity: detail.cumExecQty,
      fiatSpent: parseFloat(detail.cumExecValue).toFixed(2),
      fee: detail.cumExecFee,
      feeCurrency: detail.feeCurrency,
      errorMessage: isFilled
        ? null
        : `Test order did not fill: orderStatus=${detail.orderStatus}`,
      isTest: true,
    })
    .returning();

  logger.info("Test order finished", {
    pair,
    orderId: marketOrderId,
    status: row.status,
  });

  return row;
}
