import { sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { orders } from "./db/schema.js";

export async function getMonthlySpent(pair: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const startOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  const result = await db
    .select({
      total: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
    })
    .from(orders)
    .where(
      sql`${orders.pair} = ${pair}
        AND ${orders.status} = 'filled'
        AND ${orders.executedAt} >= ${startOfMonth.toISOString()}
        AND ${orders.executedAt} < ${startOfNextMonth.toISOString()}`
    );

  return parseFloat(result[0].total);
}
