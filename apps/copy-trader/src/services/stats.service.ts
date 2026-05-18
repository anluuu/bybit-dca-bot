import { eq, sql } from "drizzle-orm";
import type { CopyStats } from "@dca/shared";
import { db } from "../db/client.js";
import { dailyStats, trades } from "../db/schema.js";

export async function getStats(): Promise<CopyStats> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [todayRows, last7, allTime, winLoss] = await Promise.all([
    db.select().from(dailyStats).where(eq(dailyStats.day, todayStr)).limit(1),
    db
      .select({
        pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
        closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
      })
      .from(dailyStats)
      .where(sql`${dailyStats.day} > current_date - INTERVAL '7 days'`),
    db
      .select({
        pnl: sql<number>`COALESCE(SUM(${dailyStats.pnlUsdt}::numeric), 0)::float`,
        closed: sql<number>`COALESCE(SUM(${dailyStats.tradesClosed}), 0)::int`,
      })
      .from(dailyStats),
    db
      .select({
        wins: sql<number>`COUNT(*) FILTER (WHERE ${trades.status} = 'CLOSED_TP')::int`,
        losses: sql<number>`COUNT(*) FILTER (WHERE ${trades.status} IN ('CLOSED_SL','LIQUIDATED'))::int`,
      })
      .from(trades)
      .where(eq(trades.dryRun, false)),
  ]);

  return {
    today: {
      pnlUsdt: Number(todayRows[0]?.pnlUsdt ?? 0),
      tradesClosed: todayRows[0]?.tradesClosed ?? 0,
    },
    last7: { pnlUsdt: last7[0]?.pnl ?? 0, tradesClosed: last7[0]?.closed ?? 0 },
    allTime: { pnlUsdt: allTime[0]?.pnl ?? 0, tradesClosed: allTime[0]?.closed ?? 0 },
    wins: winLoss[0]?.wins ?? 0,
    losses: winLoss[0]?.losses ?? 0,
  };
}
