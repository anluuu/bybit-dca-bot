import { desc, sql } from "drizzle-orm";
import type { OrdersPage, OrdersSummary, MonthlyBreakdown, PublicOrdersPage } from "@dca/shared";
import { db } from "../db/client.js";
import { assets, orders } from "../db/schema.js";
import { mapOrderRowToWire, mapOrderRowToPublicWire } from "../dto/order.dto.js";

export const ALLOWED_STATUSES = [
  "filled",
  "failed",
  "cancelled",
  "pending",
  "skipped_cap",
] as const;

export type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

export interface ListAdminOrdersArgs {
  page: number;
  pageSize: number;
  status?: AllowedStatus[];
  includeTest: boolean;
}

export interface ListPublicOrdersArgs {
  page: number;
  pageSize: number;
}

export async function listAdminOrders(
  args: ListAdminOrdersArgs
): Promise<OrdersPage> {
  const { page, pageSize, status, includeTest } = args;

  // Build WHERE from optional filters. Paginate AND count against the same
  // predicate so totalPages reflects the filtered view.
  const conditions = [sql`1 = 1`];
  if (status && status.length > 0) {
    conditions.push(sql`${orders.status} IN ${status}`);
  }
  if (!includeTest) {
    conditions.push(sql`${orders.isTest} = false`);
  }
  const whereClause = sql.join(conditions, sql` AND `);

  const [rows, count] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(whereClause)
      .orderBy(desc(orders.executedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<string>`COUNT(*)` })
      .from(orders)
      .where(whereClause),
  ]);

  const total = parseInt(count[0].total);
  return {
    data: rows.map(mapOrderRowToWire),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function listPublicOrders(
  args: ListPublicOrdersArgs
): Promise<PublicOrdersPage> {
  const { page, pageSize } = args;

  // Select explicit columns only — never leak bybitOrderId, errorMessage,
  // or DB primary keys. Signal-related columns that ARE public-safe
  // (raw market data: Mayer value, 200W distance, F&G index) are
  // included; strategy-internal fields (compositeScore,
  // appliedMultiplier, signalFallback) stay admin-only.
  const [rows, count] = await Promise.all([
    db
      .select({
        pair: orders.pair,
        orderType: orders.orderType,
        status: orders.status,
        price: orders.price,
        quantity: orders.quantity,
        fiatSpent: orders.fiatSpent,
        fee: orders.fee,
        feeCurrency: orders.feeCurrency,
        mayerMultiple: orders.mayerMultiple,
        ma200wDistancePct: orders.ma200wDistancePct,
        fearGreedIndex: orders.fearGreedIndex,
        executedAt: orders.executedAt,
      })
      .from(orders)
      .where(sql`${orders.isTest} = false`)
      .orderBy(desc(orders.executedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<string>`COUNT(*)` })
      .from(orders)
      .where(sql`${orders.isTest} = false`),
  ]);

  const total = parseInt(count[0].total);
  return {
    data: rows.map(mapOrderRowToPublicWire),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getOrdersSummary(): Promise<OrdersSummary> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const startOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  const allFilled = await db
    .select({
      totalOrders: sql<string>`COUNT(*)`,
      totalBtc: sql<string>`COALESCE(SUM(${orders.quantity}), 0)`,
      totalSpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
      avgPrice: sql<string>`COALESCE(
        SUM(${orders.fiatSpent}) / NULLIF(SUM(${orders.quantity}), 0),
        0
      )`,
    })
    .from(orders)
    .where(sql`${orders.status} = 'filled' AND ${orders.isTest} = false`);

  const monthly = await db
    .select({
      monthlySpent: sql<string>`COALESCE(SUM(${orders.fiatSpent}), 0)`,
    })
    .from(orders)
    .where(
      sql`${orders.status} = 'filled'
        AND ${orders.isTest} = false
        AND ${orders.executedAt} >= ${startOfMonth.toISOString()}
        AND ${orders.executedAt} < ${startOfNextMonth.toISOString()}`
    );

  const firstAsset = await db.select().from(assets).limit(1);

  return {
    totalOrders: parseInt(allFilled[0].totalOrders),
    totalBtc: parseFloat(allFilled[0].totalBtc),
    totalSpent: parseFloat(allFilled[0].totalSpent),
    avgPrice: parseFloat(allFilled[0].avgPrice),
    monthlySpent: parseFloat(monthly[0].monthlySpent),
    monthlyCap: firstAsset[0] ? parseFloat(firstAsset[0].monthlyCap) : 1000,
  };
}

/**
 * Per-calendar-month aggregation (UTC). Returns rows newest-first with
 * volume-weighted avg price and a delta vs. the chronologically previous
 * month. Shared by the admin and public monthly endpoints.
 */
export async function getMonthlyBreakdown(): Promise<MonthlyBreakdown[]> {
  const rows = await db.execute<{
    month: string;
    order_count: string;
    total_btc: string;
    total_spent: string;
    avg_price: string | null;
    min_price: string | null;
    max_price: string | null;
  }>(sql`
    SELECT
      to_char(${orders.executedAt} AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
      COUNT(*)::text AS order_count,
      COALESCE(SUM(${orders.quantity}), 0)::text AS total_btc,
      COALESCE(SUM(${orders.fiatSpent}), 0)::text AS total_spent,
      (SUM(${orders.fiatSpent}) / NULLIF(SUM(${orders.quantity}), 0))::text AS avg_price,
      MIN(${orders.price})::text AS min_price,
      MAX(${orders.price})::text AS max_price
    FROM ${orders}
    WHERE ${orders.status} = 'filled'
      AND ${orders.isTest} = false
      AND ${orders.quantity} IS NOT NULL
      AND ${orders.fiatSpent} IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  const monthLabelFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  // rows are newest-first; to compute vsPrevPct we need each month's
  // predecessor (chronologically earlier), which in a newest-first array
  // is the *next* index.
  return rows.map((r, i) => {
    const [y, m] = r.month.split("-").map(Number);
    const label = monthLabelFmt.format(new Date(Date.UTC(y, m - 1, 1)));
    const avgPrice = parseFloat(r.avg_price ?? "0");
    const prev = rows[i + 1];
    const prevAvg = prev ? parseFloat(prev.avg_price ?? "0") : 0;
    const vsPrevPct =
      prev && prevAvg > 0 ? ((avgPrice - prevAvg) / prevAvg) * 100 : null;

    return {
      month: r.month,
      label,
      orderCount: parseInt(r.order_count, 10),
      totalBtc: parseFloat(r.total_btc),
      totalSpent: parseFloat(r.total_spent),
      avgPrice,
      minPrice: parseFloat(r.min_price ?? "0"),
      maxPrice: parseFloat(r.max_price ?? "0"),
      vsPrevPct,
    };
  });
}

export async function getChartData() {
  const filled = await db
    .select({
      executedAt: orders.executedAt,
      quantity: orders.quantity,
      fiatSpent: orders.fiatSpent,
      mayerMultiple: orders.mayerMultiple,
      ma200wDistancePct: orders.ma200wDistancePct,
    })
    .from(orders)
    .where(sql`${orders.status} = 'filled' AND ${orders.isTest} = false`)
    .orderBy(orders.executedAt);

  let cumulativeBtc = 0;
  let cumulativeSpent = 0;

  return filled.map((o) => {
    cumulativeBtc += parseFloat(o.quantity!);
    cumulativeSpent += parseFloat(o.fiatSpent!);
    return {
      date: o.executedAt.toISOString(),
      btc: parseFloat(cumulativeBtc.toFixed(8)),
      spent: parseFloat(cumulativeSpent.toFixed(2)),
      mayer: o.mayerMultiple ? parseFloat(o.mayerMultiple) : null,
      ma200wDistancePct: o.ma200wDistancePct
        ? parseFloat(o.ma200wDistancePct)
        : null,
    };
  });
}
