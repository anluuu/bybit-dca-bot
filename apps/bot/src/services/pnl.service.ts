import { sql } from "drizzle-orm";
import type { PortfolioPnl } from "@dca/shared";
import { db } from "../db/client.js";
import { orders } from "../db/schema.js";
import { getPrice } from "../infra/priceCache.js";

export async function getPnl(pair: string): Promise<PortfolioPnl> {
  const [agg] = await db
    .select({
      totalBtc: sql<string>`COALESCE(SUM(${orders.quantity}), 0)`,
      totalSpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      avgPrice: sql<string>`COALESCE(
        SUM(${orders.fiatSpent}) / NULLIF(SUM(${orders.quantity}), 0),
        0
      )`,
    })
    .from(orders)
    .where(
      sql`${orders.status} = 'filled'
        AND ${orders.isTest} = false
        AND ${orders.pair} = ${pair}`
    );

  const totalBtc = parseFloat(agg.totalBtc);
  const totalSpent = parseFloat(agg.totalSpent);
  const avgPrice = parseFloat(agg.avgPrice);

  const priceLookup = await getPrice(pair);
  const currentPrice = priceLookup.price;

  const portfolioValue =
    currentPrice !== null ? currentPrice * totalBtc : null;
  const unrealizedPnl =
    portfolioValue !== null && totalBtc > 0
      ? portfolioValue - totalSpent
      : null;
  const roiPct =
    unrealizedPnl !== null && totalSpent > 0
      ? (unrealizedPnl / totalSpent) * 100
      : null;
  const avgVsSpotPct =
    currentPrice !== null && avgPrice > 0
      ? ((currentPrice - avgPrice) / avgPrice) * 100
      : null;

  return {
    pair,
    currentPrice,
    priceAsOf: priceLookup.fetchedAt,
    priceStale: priceLookup.stale,
    totalBtc,
    totalSpent,
    avgPrice,
    portfolioValue,
    unrealizedPnl,
    roiPct,
    avgVsSpotPct,
    generatedAt: new Date().toISOString(),
  };
}
