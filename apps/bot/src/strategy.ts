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
import { getInstrumentInfo, roundDownToStep } from "./instrumentInfo.js";
import { getMonthlySpent } from "./spending.js";
import {
  ensureSpotBalance,
  InsufficientFundsError,
} from "./balance.js";
import {
  notifySuccess,
  notifyFailure,
  notifyCapReached,
  notifyFallback,
  notifyInsufficientFunds,
} from "./notifications.js";
import { getCompositeSignal, type CompositeSignal } from "./signals/compose.js";
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

function recordOrderResult(detail: OrderDetail, pair: string, orderType: string) {
  return {
    pair,
    orderType,
    price: parseFloat(detail.avgPrice),
    quantity: parseFloat(detail.cumExecQty),
    fiatSpent: parseFloat(detail.cumExecValue),
    fee: parseFloat(detail.cumExecFee),
    feeCurrency: detail.feeCurrency,
  };
}

const QUOTE_COIN = "BRL";

/**
 * Place a limit order with pre-flight top-up and a single reactive retry.
 *
 * Pre-flight: ensureSpotBalance pulls from Funding if Spot can't cover
 * `requiredBrl`. Reactive: if Bybit *still* says 170131 (Spot drained between
 * check and place — possible if a human or another bot moves BRL out), one
 * more ensureSpotBalance + placeLimitOrder attempt. If that retry also throws
 * 170131 the error propagates and the DCA fails normally.
 *
 * `requiredBrl` is the BRL amount the order intends to consume. The wrapper
 * adds a 10% buffer internally via ensureSpotBalance's deficit math.
 */
async function placeLimitOrderWithRetry(
  pair: string,
  qty: string,
  price: string,
  requiredBrl: number
): Promise<string> {
  const required = requiredBrl * 1.1;
  await ensureSpotBalance(QUOTE_COIN, required);
  try {
    return await placeLimitOrder(pair, qty, price);
  } catch (error) {
    if (
      error instanceof ExchangeClientError &&
      error.statusCode === 170131
    ) {
      logger.warn("Race on insufficient balance — re-topping up and retrying", {
        pair,
        requiredBrl,
      });
      await ensureSpotBalance(QUOTE_COIN, required);
      return await placeLimitOrder(pair, qty, price);
    }
    throw error;
  }
}

async function placeMarketOrderWithRetry(
  pair: string,
  quoteAmount: string,
  requiredBrl: number
): Promise<string> {
  const required = requiredBrl * 1.1;
  await ensureSpotBalance(QUOTE_COIN, required);
  try {
    return await placeMarketOrder(pair, quoteAmount);
  } catch (error) {
    if (
      error instanceof ExchangeClientError &&
      error.statusCode === 170131
    ) {
      logger.warn("Race on insufficient balance — re-topping up and retrying", {
        pair,
        requiredBrl,
      });
      await ensureSpotBalance(QUOTE_COIN, required);
      return await placeMarketOrder(pair, quoteAmount);
    }
    throw error;
  }
}

/**
 * Project a resolved CompositeSignal into the signal columns on the orders
 * row. Captured purely for dashboard context — no bot behavior reads these.
 */
function signalColumns(signal: CompositeSignal) {
  return {
    mayerMultiple: signal.mayer ? signal.mayer.multiple.toFixed(4) : null,
    ma200wDistancePct: signal.ma200w
      ? signal.ma200w.distancePct.toFixed(4)
      : null,
    fearGreedIndex: signal.fearGreed ? signal.fearGreed.value : null,
    compositeScore: signal.composite.toFixed(4),
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

  // 1. Check monthly spending cap
  const spent = await getMonthlySpent(pair);
  if (spent + buyAmount > monthlyCap) {
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

  // 2. Fetch signal snapshot for dashboard context. The buy size does not
  // react to these — they're captured on the order row so every buy carries
  // the market context it was placed in. Failure is already absorbed inside
  // getCompositeSignal (graceful fallback tree), so we don't guard here.
  const signal = await getCompositeSignal(pair);

  // 3. Fetch current price
  let currentPrice: number;
  try {
    currentPrice = await getTickerPrice(pair);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 4. Calculate limit order params. Price and qty must match the pair's
  // exchange-side step sizes (tickSize / basePrecision) — hardcoded decimals
  // caused prod rejection "Order price has too many decimals" (code 170134)
  // on 2026-04-19 when the BTCBRL tick widened. Instrument info is cached
  // for 24h; a miss here falls back to ExchangeApiError → retryable.
  const instrument = await getInstrumentInfo(pair);
  const limitPrice = currentPrice * (1 - limitDiscount / 100);
  const quantity = buyAmount / limitPrice;

  const priceStr = roundDownToStep(limitPrice, instrument.tickSize);
  const qtyStr = roundDownToStep(quantity, instrument.basePrecision);

  // 5. Place limit order — wrapper pre-tops Spot from Funding if needed and
  // retries once on a race-induced 170131. InsufficientFundsError surfaces
  // here for the dedicated Telegram alert before the generic Unrecoverable
  // catch fires.
  let limitOrderId: string;
  try {
    limitOrderId = await placeLimitOrderWithRetry(
      pair,
      qtyStr,
      priceStr,
      buyAmount
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      throw new UnrecoverableError(error.message);
    }
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 6. Record pending order (with signal snapshot for dashboard badges).
  const [insertedOrder] = await db
    .insert(orders)
    .values({
      assetId,
      pair,
      orderType: "limit",
      bybitOrderId: limitOrderId,
      status: "pending",
      ...signalColumns(signal),
    })
    .returning({ id: orders.id });

  // 7. Poll for limit order fill
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

      await notifySuccess(recordOrderResult(detail, pair, "limit"));
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

  // 8. Limit order not filled — cancel and fallback to market
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

  // 9. Place market order via wrapper (same auto-topup + retry as limit).
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrderWithRetry(
      pair,
      buyAmount.toFixed(2),
      buyAmount
    );
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      throw new UnrecoverableError(error.message);
    }
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 10. Poll market order with retries (not just a single sleep)
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
    ...signalColumns(signal),
  });

  if (isFilled) {
    await notifySuccess(recordOrderResult(marketDetail, pair, "market"));
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
    marketOrderId = await placeMarketOrderWithRetry(
      pair,
      amountBrl.toFixed(2),
      amountBrl
    );
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

    if (error instanceof InsufficientFundsError) {
      // Test orders fire a critical alert too — operators want to know
      // BEFORE the next scheduled DCA hits the same wall.
      await notifyInsufficientFunds(
        pair,
        error.available,
        error.required,
        error.coin
      );
      return failedRow;
    }

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
