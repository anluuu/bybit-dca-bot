CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" varchar(20) NOT NULL,
	"buy_amount" numeric(16, 2) NOT NULL,
	"monthly_cap" numeric(16, 2) NOT NULL,
	"cron_schedule" varchar(50) NOT NULL,
	"limit_discount" numeric(5, 3) DEFAULT '0.300' NOT NULL,
	"limit_wait_mins" integer DEFAULT 120 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_pair_unique" UNIQUE("pair")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"pair" varchar(20) NOT NULL,
	"order_type" varchar(10) NOT NULL,
	"bybit_order_id" varchar(64),
	"status" varchar(20) NOT NULL,
	"price" numeric(20, 8),
	"quantity" numeric(20, 8),
	"fiat_spent" numeric(16, 2),
	"fee" numeric(20, 8),
	"fee_currency" varchar(10),
	"error_message" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_orders_pair_executed_at" ON "orders" USING btree ("pair","executed_at");--> statement-breakpoint
CREATE INDEX "idx_orders_asset_id" ON "orders" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status");