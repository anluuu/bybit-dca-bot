import { z } from "zod/v4";

const configSchema = z.object({
  BYBIT_API_KEY: z.string().min(1),
  BYBIT_API_SECRET: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  BUY_AMOUNT_BRL: z.coerce.number().positive(),
  MONTHLY_CAP_BRL: z.coerce.number().positive(),
  CRON_SCHEDULE: z.string().min(1).default("0 8 * * 0"),
  LIMIT_DISCOUNT_PCT: z.coerce.number().min(0).max(5).default(0.3),
  LIMIT_WAIT_MINUTES: z.coerce.number().int().min(1).max(1440).default(120),
  TRADING_PAIR: z.string().min(1).default("BTCBRL"),
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
