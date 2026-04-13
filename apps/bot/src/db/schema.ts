import {
  pgTable,
  serial,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  text,
  index,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  pair: varchar("pair", { length: 20 }).notNull().unique(),
  buyAmount: numeric("buy_amount", { precision: 16, scale: 2 }).notNull(),
  monthlyCap: numeric("monthly_cap", { precision: 16, scale: 2 }).notNull(),
  cronSchedule: varchar("cron_schedule", { length: 50 }).notNull(),
  limitDiscount: numeric("limit_discount", { precision: 5, scale: 3 })
    .notNull()
    .default("0.300"),
  limitWaitMins: integer("limit_wait_mins").notNull().default(120),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assets.id),
    pair: varchar("pair", { length: 20 }).notNull(),
    orderType: varchar("order_type", { length: 10 }).notNull(),
    bybitOrderId: varchar("bybit_order_id", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull(),
    price: numeric("price", { precision: 20, scale: 8 }),
    quantity: numeric("quantity", { precision: 20, scale: 8 }),
    fiatSpent: numeric("fiat_spent", { precision: 16, scale: 2 }),
    fee: numeric("fee", { precision: 20, scale: 8 }),
    feeCurrency: varchar("fee_currency", { length: 10 }),
    errorMessage: text("error_message"),
    isTest: boolean("is_test").notNull().default(false),
    // Signal snapshot at order placement — dashboard context only; the bot's
    // buy size does not react to these. All nullable so historical rows and
    // orders placed during signal outages still persist.
    mayerMultiple: numeric("mayer_multiple", { precision: 8, scale: 4 }),
    ma200wDistancePct: numeric("ma_200w_distance_pct", { precision: 8, scale: 4 }),
    fearGreedIndex: integer("fear_greed_index"),
    compositeScore: numeric("composite_score", { precision: 5, scale: 4 }),
    signalFallback: varchar("signal_fallback", { length: 32 }),
    executedAt: timestamp("executed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_orders_pair_executed_at").on(table.pair, table.executedAt),
    index("idx_orders_asset_id").on(table.assetId),
    index("idx_orders_status").on(table.status),
  ]
);

export type Asset = InferSelectModel<typeof assets>;
export type NewAsset = InferInsertModel<typeof assets>;
export type Order = InferSelectModel<typeof orders>;
export type NewOrder = InferInsertModel<typeof orders>;
