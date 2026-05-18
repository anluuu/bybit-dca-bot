import { z } from "zod/v4";

const configSchema = z.object({
  // Telegram MTProto user session (NOT a bot token)
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_SESSION_STRING: z.string().min(1),
  SIGNAL_CHANNEL_ID: z.coerce.number().int(),

  // Telegram notification bot (separate, telegraf)
  TELEGRAM_NOTIFY_BOT_TOKEN: z.string().min(1),
  TELEGRAM_NOTIFY_CHAT_ID: z.string().min(1),

  // Postgres
  DATABASE_URL: z.string().startsWith("postgres"),

  // Auth (shared with bot for dashboard SSO)
  JWT_SECRET: z.string().min(32),

  // Operation
  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Reconcile window
  BOOT_RECONCILE_LIMIT: z.coerce.number().int().min(0).max(500).default(50),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const config = Object.freeze(result.data);
