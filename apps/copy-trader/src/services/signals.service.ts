import { desc, eq, sql } from "drizzle-orm";
import type { CopySignalsPage } from "@dca/shared";
import { db } from "../db/client.js";
import { signals } from "../db/schema.js";
import { mapSignalRowToWire } from "../dto/signal.dto.js";

export interface ListSignalsArgs {
  page: number;
  pageSize: number;
  status?: string;
}

export async function listSignals(args: ListSignalsArgs): Promise<CopySignalsPage> {
  const page = Math.max(1, args.page);
  const pageSize = Math.min(200, Math.max(1, args.pageSize));
  const offset = (page - 1) * pageSize;
  const where = args.status ? eq(signals.status, args.status) : undefined;

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(signals)
      .where(where)
      .orderBy(desc(signals.receivedAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(signals).where(where),
  ]);

  return {
    page,
    pageSize,
    total: total[0]?.count ?? 0,
    items: rows.map(mapSignalRowToWire),
  };
}
