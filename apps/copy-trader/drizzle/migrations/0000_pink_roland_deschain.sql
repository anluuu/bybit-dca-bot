CREATE SCHEMA IF NOT EXISTS "copy_trader";
--> statement-breakpoint
CREATE TABLE "copy_trader"."config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_trader"."daily_stats" (
	"day" date PRIMARY KEY NOT NULL,
	"trades_opened" integer DEFAULT 0 NOT NULL,
	"trades_closed" integer DEFAULT 0 NOT NULL,
	"pnl_usdt" numeric(20, 8) DEFAULT '0' NOT NULL,
	"balance_start" numeric(20, 8),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_trader"."signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_hash" text NOT NULL,
	"raw_text" text NOT NULL,
	"telegram_msg_id" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" text,
	"symbol" text,
	"entry_low" numeric(20, 8),
	"entry_high" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"leverage_raw" integer,
	"take_profit_1" numeric(20, 8),
	"take_profit_2" numeric(20, 8),
	"take_profit_3" numeric(20, 8),
	"status" text NOT NULL,
	"skip_reason" text,
	"trade_id" uuid,
	CONSTRAINT "signals_signal_hash_key" UNIQUE("signal_hash"),
	CONSTRAINT "signals_status_check" CHECK ("copy_trader"."signals"."status" IN ('PARSED','UNPARSEABLE','SKIPPED','EXECUTED'))
);
--> statement-breakpoint
CREATE TABLE "copy_trader"."system_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"killed" boolean DEFAULT false NOT NULL,
	"killed_reason" text,
	"killed_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"cooldown_reason" text,
	"initial_capital" numeric(20, 8),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_state_singleton" CHECK ("copy_trader"."system_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "copy_trader"."trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"bybit_order_id" text,
	"bybit_order_link_id" text NOT NULL,
	"bybit_position_idx" integer DEFAULT 0 NOT NULL,
	"planned_qty" numeric(20, 8) NOT NULL,
	"planned_margin" numeric(20, 8) NOT NULL,
	"leverage_used" integer NOT NULL,
	"entry_strategy" text NOT NULL,
	"limit_price" numeric(20, 8),
	"limit_expires_at" timestamp with time zone,
	"filled_qty" numeric(20, 8),
	"avg_entry" numeric(20, 8),
	"fill_ts" timestamp with time zone,
	"tp_price" numeric(20, 8) NOT NULL,
	"sl_price" numeric(20, 8) NOT NULL,
	"status" text NOT NULL,
	"close_reason" text,
	"exit_price" numeric(20, 8),
	"close_ts" timestamp with time zone,
	"pnl_usdt" numeric(20, 8),
	"fees_usdt" numeric(20, 8),
	"error_message" text,
	"dry_run" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_bybit_order_link_id_key" UNIQUE("bybit_order_link_id"),
	CONSTRAINT "trades_status_check" CHECK ("copy_trader"."trades"."status" IN ('DRY_RUN_LOGGED','PENDING_FILL','OPEN','NOT_FILLED','CLOSED_TP','CLOSED_SL','CLOSED_MANUAL','LIQUIDATED','ERROR')),
	CONSTRAINT "trades_entry_strategy_check" CHECK ("copy_trader"."trades"."entry_strategy" IN ('MARKET','LIMIT_CHASE'))
);
--> statement-breakpoint
ALTER TABLE "copy_trader"."trades" ADD CONSTRAINT "trades_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "copy_trader"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signals_received_at_idx" ON "copy_trader"."signals" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signals_status_idx" ON "copy_trader"."signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_status_idx" ON "copy_trader"."trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_signal_id_idx" ON "copy_trader"."trades" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "trades_created_at_idx" ON "copy_trader"."trades" USING btree ("created_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "copy_trader"."signals"
  ADD CONSTRAINT "signals_trade_id_fkey"
  FOREIGN KEY ("trade_id") REFERENCES "copy_trader"."trades"("id");