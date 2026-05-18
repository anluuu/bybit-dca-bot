import {
  pgSchema,
  uuid,
  text,
  bigint,
  numeric,
  integer,
  timestamp,
  boolean,
  date,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql, type InferSelectModel, type InferInsertModel } from "drizzle-orm";

export const copyTrader = pgSchema("copy_trader");

export const signals = copyTrader.table(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalHash: text("signal_hash").notNull(),
    rawText: text("raw_text").notNull(),
    telegramMsgId: bigint("telegram_msg_id", { mode: "number" }).notNull(),
    telegramSenderId: bigint("telegram_sender_id", { mode: "number" }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    direction: text("direction"),
    symbol: text("symbol"),
    entryLow: numeric("entry_low", { precision: 20, scale: 8 }),
    entryHigh: numeric("entry_high", { precision: 20, scale: 8 }),
    stopLoss: numeric("stop_loss", { precision: 20, scale: 8 }),
    leverageRaw: integer("leverage_raw"),
    takeProfit1: numeric("take_profit_1", { precision: 20, scale: 8 }),
    takeProfit2: numeric("take_profit_2", { precision: 20, scale: 8 }),
    takeProfit3: numeric("take_profit_3", { precision: 20, scale: 8 }),
    status: text("status").notNull(),
    skipReason: text("skip_reason"),
    tradeId: uuid("trade_id"),
  },
  (t) => [
    unique("signals_signal_hash_key").on(t.signalHash),
    index("signals_received_at_idx").on(t.receivedAt.desc()),
    index("signals_status_idx").on(t.status),
    check(
      "signals_status_check",
      sql`${t.status} IN ('PARSED','UNPARSEABLE','SKIPPED','EXECUTED')`
    ),
  ]
);

export const trades = copyTrader.table(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id").notNull().references(() => signals.id),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    bybitOrderId: text("bybit_order_id"),
    bybitOrderLinkId: text("bybit_order_link_id").notNull(),
    bybitPositionIdx: integer("bybit_position_idx").notNull().default(0),
    plannedQty: numeric("planned_qty", { precision: 20, scale: 8 }).notNull(),
    plannedMargin: numeric("planned_margin", {
      precision: 20,
      scale: 8,
    }).notNull(),
    leverageUsed: integer("leverage_used").notNull(),
    entryStrategy: text("entry_strategy").notNull(),
    limitPrice: numeric("limit_price", { precision: 20, scale: 8 }),
    limitExpiresAt: timestamp("limit_expires_at", { withTimezone: true }),
    filledQty: numeric("filled_qty", { precision: 20, scale: 8 }),
    avgEntry: numeric("avg_entry", { precision: 20, scale: 8 }),
    fillTs: timestamp("fill_ts", { withTimezone: true }),
    tpPrice: numeric("tp_price", { precision: 20, scale: 8 }).notNull(),
    slPrice: numeric("sl_price", { precision: 20, scale: 8 }).notNull(),
    status: text("status").notNull(),
    closeReason: text("close_reason"),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
    closeTs: timestamp("close_ts", { withTimezone: true }),
    pnlUsdt: numeric("pnl_usdt", { precision: 20, scale: 8 }),
    feesUsdt: numeric("fees_usdt", { precision: 20, scale: 8 }),
    errorMessage: text("error_message"),
    dryRun: boolean("dry_run").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("trades_bybit_order_link_id_key").on(t.bybitOrderLinkId),
    index("trades_status_idx").on(t.status),
    index("trades_signal_id_idx").on(t.signalId),
    index("trades_created_at_idx").on(t.createdAt.desc()),
    check(
      "trades_status_check",
      sql`${t.status} IN ('DRY_RUN_LOGGED','PENDING_FILL','OPEN','NOT_FILLED','CLOSED_TP','CLOSED_SL','CLOSED_MANUAL','LIQUIDATED','ERROR')`
    ),
    check(
      "trades_entry_strategy_check",
      sql`${t.entryStrategy} IN ('MARKET','LIMIT_CHASE')`
    ),
  ]
);

export const dailyStats = copyTrader.table("daily_stats", {
  day: date("day").primaryKey(),
  tradesOpened: integer("trades_opened").notNull().default(0),
  tradesClosed: integer("trades_closed").notNull().default(0),
  pnlUsdt: numeric("pnl_usdt", { precision: 20, scale: 8 })
    .notNull()
    .default("0"),
  balanceStart: numeric("balance_start", { precision: 20, scale: 8 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const systemState = copyTrader.table(
  "system_state",
  {
    id: integer("id").primaryKey().default(1),
    killed: boolean("killed").notNull().default(false),
    killedReason: text("killed_reason"),
    killedAt: timestamp("killed_at", { withTimezone: true }),
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    cooldownReason: text("cooldown_reason"),
    initialCapital: numeric("initial_capital", { precision: 20, scale: 8 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("system_state_singleton", sql`${t.id} = 1`)]
);

export const configTable = copyTrader.table("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Signal = InferSelectModel<typeof signals>;
export type NewSignal = InferInsertModel<typeof signals>;
export type Trade = InferSelectModel<typeof trades>;
export type NewTrade = InferInsertModel<typeof trades>;
export type DailyStats = InferSelectModel<typeof dailyStats>;
export type NewDailyStats = InferInsertModel<typeof dailyStats>;
export type SystemState = InferSelectModel<typeof systemState>;
export type NewSystemState = InferInsertModel<typeof systemState>;
export type ConfigRow = InferSelectModel<typeof configTable>;
export type NewConfigRow = InferInsertModel<typeof configTable>;
