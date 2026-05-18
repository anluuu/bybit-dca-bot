import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders } from "../db/schema.js";
import { getTickerPrice } from "../infra/exchange.js";
import { getMonthlySpent } from "../domain/spending.js";
import { config } from "../config.js";
import type { Asset } from "../db/schema.js";

/**
 * Return a human-readable reason if there's an in-flight (pending) order
 * on this pair recently, which would indicate a real DCA job is mid-execution.
 * Test orders must not race with the real worker.
 */
export async function findBusyReason(pair: string): Promise<string | null> {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const pending = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      sql`${orders.pair} = ${pair}
        AND ${orders.status} = 'pending'
        AND ${orders.executedAt} >= ${tenMinAgo}`
    )
    .limit(1);

  if (pending.length > 0) {
    return "Another order is already in flight for this pair. Wait for it to finish.";
  }
  return null;
}

export interface TestPreviewResult {
  pair: string;
  testAmountBrl: number;
  currentPrice: number;
  estimatedQty: number;
  monthlySpent: number;
  monthlyCap: number;
  busy: boolean;
  busyReason: string | null;
  generatedAt: string;
}

export async function buildTestPreview(
  asset: Asset
): Promise<{ ok: true; preview: TestPreviewResult } | { ok: false; error: string; status: number }> {
  let currentPrice: number;
  try {
    currentPrice = await getTickerPrice(asset.pair);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Ticker fetch failed: ${msg}`, status: 502 };
  }

  const testAmountBrl = config.TEST_ORDER_AMOUNT_BRL;
  const estimatedQty = testAmountBrl / currentPrice;
  const monthlySpent = await getMonthlySpent(asset.pair);
  const monthlyCap = parseFloat(asset.monthlyCap);
  const busyReason = await findBusyReason(asset.pair);

  return {
    ok: true,
    preview: {
      pair: asset.pair,
      testAmountBrl,
      currentPrice,
      estimatedQty,
      monthlySpent,
      monthlyCap,
      busy: busyReason !== null,
      busyReason,
      generatedAt: new Date().toISOString(),
    },
  };
}
