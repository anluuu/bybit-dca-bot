import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { CopyTradesPage } from "@dca/shared";
import { db } from "../db/client.js";
import { trades } from "../db/schema.js";
import { mapTradeRowToWire } from "../dto/trade.dto.js";
import { normalizePage } from "../paginate.js";

export interface ListTradesArgs {
  page: number;
  pageSize: number;
  status?: string;
  includeDryRun: boolean;
}

export async function listTrades(args: ListTradesArgs): Promise<CopyTradesPage> {
  const { page, pageSize, offset } = normalizePage(args.page, args.pageSize);

  const conditions: SQL[] = [];
  if (args.status) conditions.push(eq(trades.status, args.status));
  if (!args.includeDryRun) conditions.push(eq(trades.dryRun, false));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(trades)
      .where(where)
      .orderBy(desc(trades.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(trades).where(where),
  ]);

  return {
    page,
    pageSize,
    total: total[0]?.count ?? 0,
    items: rows.map(mapTradeRowToWire),
  };
}
