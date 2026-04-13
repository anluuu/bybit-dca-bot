import { UnrecoverableError } from "bullmq";
import { db } from "./db/client.js";
import { orders, type Asset } from "./db/schema.js";
import { eq } from "drizzle-orm";
import {
  getTickerPrice,
  placeLimitOrder,
  placeMarketOrder,
  cancelOrder,
  getOrderDetail,
  ExchangeClientError,
} from "./exchange.js";
import { getMonthlySpent } from "./spending.js";
import {
  notifySuccess,
  notifyFailure,
  notifyCapReached,
  notifyFallback,
} from "./notifications.js";
import { logger } from "./logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // 2. Fetch current price
  let currentPrice: number;
  try {
    currentPrice = await getTickerPrice(pair);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 3. Calculate limit order params
  const limitPrice = currentPrice * (1 - limitDiscount / 100);
  const quantity = buyAmount / limitPrice;

  // Round price to 2 decimals, quantity to 6 decimals (Bybit BTC/BRL typical)
  const priceStr = limitPrice.toFixed(2);
  const qtyStr = quantity.toFixed(6);

  // 4. Place limit order
  let limitOrderId: string;
  try {
    limitOrderId = await placeLimitOrder(pair, qtyStr, priceStr);
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // 5. Record pending order
  const [insertedOrder] = await db
    .insert(orders)
    .values({
      assetId,
      pair,
      orderType: "limit",
      bybitOrderId: limitOrderId,
      status: "pending",
    })
    .returning({ id: orders.id });

  // 6. Poll for limit order fill
  const pollIntervalMs = 30_000;
  const maxPolls = Math.ceil((limitWaitMins * 60_000) / pollIntervalMs);
  let filled = false;

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollIntervalMs);

    const detail = await getOrderDetail(pair, limitOrderId);

    if (detail.status === "Filled") {
      filled = true;

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

      await notifySuccess({
        pair,
        orderType: "limit",
        price: parseFloat(detail.avgPrice),
        quantity: parseFloat(detail.cumExecQty),
        fiatSpent: parseFloat(detail.cumExecValue),
        fee: parseFloat(detail.cumExecFee),
        feeCurrency: detail.feeCurrency,
      });

      logger.info("Limit order filled", { pair, orderId: limitOrderId });
      return;
    }

    if (detail.status === "Cancelled" || detail.status === "Rejected") {
      logger.warn("Limit order was cancelled/rejected externally", {
        pair,
        orderId: limitOrderId,
        status: detail.status,
      });
      break;
    }

    logger.info("Polling limit order", {
      pair,
      orderId: limitOrderId,
      poll: i + 1,
      maxPolls,
      status: detail.status,
    });
  }

  if (filled) return;

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

  await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(eq(orders.id, insertedOrder.id));

  await notifyFallback(pair, limitOrderId);

  // 8. Place market order
  let marketOrderId: string;
  try {
    marketOrderId = await placeMarketOrder(pair, buyAmount.toFixed(2));
  } catch (error) {
    if (error instanceof ExchangeClientError) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  // Wait briefly for market order to fill
  await sleep(5_000);

  const marketDetail = await getOrderDetail(pair, marketOrderId);

  await db.insert(orders).values({
    assetId,
    pair,
    orderType: "market",
    bybitOrderId: marketOrderId,
    status: marketDetail.status === "Filled" ? "filled" : "failed",
    price: marketDetail.avgPrice,
    quantity: marketDetail.cumExecQty,
    fiatSpent: parseFloat(marketDetail.cumExecValue).toFixed(2),
    fee: marketDetail.cumExecFee,
    feeCurrency: marketDetail.feeCurrency,
  });

  if (marketDetail.status === "Filled") {
    await notifySuccess({
      pair,
      orderType: "market",
      price: parseFloat(marketDetail.avgPrice),
      quantity: parseFloat(marketDetail.cumExecQty),
      fiatSpent: parseFloat(marketDetail.cumExecValue),
      fee: parseFloat(marketDetail.cumExecFee),
      feeCurrency: marketDetail.feeCurrency,
    });
    logger.info("Market fallback order filled", {
      pair,
      orderId: marketOrderId,
    });
  } else {
    const errorMsg = `Market order not filled: status=${marketDetail.status}`;
    await notifyFailure(errorMsg, pair);
    throw new Error(errorMsg);
  }
}
