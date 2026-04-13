ALTER TABLE "orders" ADD COLUMN "mayer_multiple" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ma_200w_distance_pct" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fear_greed_index" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "composite_score" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "applied_multiplier" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "signal_fallback" varchar(32);