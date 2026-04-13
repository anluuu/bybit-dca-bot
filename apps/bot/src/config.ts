import { z } from "zod/v4";

const configSchema = z.object({
  BYBIT_API_KEY: z.string().min(1),
  BYBIT_API_SECRET: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  BUY_AMOUNT_BRL: z.coerce.number().positive(),
  MONTHLY_CAP_BRL: z.coerce.number().positive(),
  TEST_ORDER_AMOUNT_BRL: z.coerce.number().positive().default(10),
  CRON_SCHEDULE: z.string().min(1).default("0 8 * * 0"),
  LIMIT_DISCOUNT_PCT: z.coerce.number().min(0).max(5).default(0.3),
  LIMIT_WAIT_MINUTES: z.coerce.number().int().min(1).max(1440).default(120),
  TRADING_PAIR: z.string().min(1).default("BTCBRL"),
  // Signal-aware DCA. When false (default), signals are still CAPTURED on
  // every order row for dashboard display and historical analysis, but the
  // buy amount stays flat at buyAmount. When true, the buy amount is scaled
  // by the composite multiplier in [0.5, 2.0] and clamped to monthly cap.
  // Do not flip to true before the backtest gate has been cleared.
  SIGNAL_MODULATION_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // Smallest order Bybit will accept for the trading pair (BRL). If a
  // modulated multiplier or the remaining monthly cap would drop the buy
  // below this floor, the week is skipped with status "skipped_min_order".
  MIN_ORDER_BRL: z.coerce.number().positive().default(10),
  DATABASE_URL: z.string().startsWith("postgres"),
  REDIS_URL: z.string().startsWith("redis").default("redis://localhost:6379"),
  PORT: z.coerce.number().int().default(3000),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(8),
  JWT_SECRET: z.string().min(32),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const config = Object.freeze(result.data);
