import { z } from "zod/v4";

const configSchema = z.object({
  // Telegram MTProto user session (NOT a bot token)
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_SESSION_STRING: z.string().min(1),
  SIGNAL_CHANNEL_ID: z.coerce.number().int(),

  // Optional Telegram forum topic id. When set, only messages posted inside
  // this topic are ingested. Use it when the source is a Telegram supergroup
  // with topics (forum) — e.g. "Grupo VIP" → topic "Sinais". Leave empty to
  // ingest from the whole channel.
  SIGNAL_TOPIC_ID: z.coerce.number().int().optional(),

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

  // Optional CSV of Telegram sender IDs to whitelist. When non-empty, messages
  // from any other sender are dropped before they hit the parser or DB. Empty
  // = passthrough (ingest from anyone in the channel).
  COPY_TG_ALLOWED_SENDER_IDS: z.string().default(""),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

const parsed = result.data;
const allowedSenderIds = parsed.COPY_TG_ALLOWED_SENDER_IDS.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n));

export const config = Object.freeze({
  ...parsed,
  allowedSenderIds: new Set(allowedSenderIds),
});
