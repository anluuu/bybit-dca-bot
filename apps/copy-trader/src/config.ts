import { z } from "zod/v4";

export const emptyStringToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const optionalPositiveInt = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional()
);

const configSchema = z.object({
  // Telegram MTProto user session (NOT a bot token)
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_SESSION_STRING: z.string().min(1),
  SIGNAL_CHANNEL_ID: z.coerce.number().int(),
  SIGNAL_TOPIC_ID: optionalPositiveInt,

  // Telegram notification bot (separate, telegraf)
  TELEGRAM_NOTIFY_BOT_TOKEN: z.string().min(1),
  TELEGRAM_NOTIFY_CHAT_ID: z.string().min(1),

  // Postgres
  DATABASE_URL: z.string().startsWith("postgres"),

  // Redis (BullMQ for the position watcher)
  REDIS_URL: z.string().startsWith("redis").default("redis://localhost:6379"),

  // Bybit (perpetual futures sub-account). Empty defaults allow F1 to boot
  // and dry-run even before the operator has wired the real key — the
  // executor logs a soft error per attempt and the watcher idles.
  BYBIT_API_KEY: z.string().default(""),
  BYBIT_API_SECRET: z.string().default(""),
  BYBIT_TESTNET: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => (typeof v === "boolean" ? v : v === "true")),

  // Optional override of the initial-capital baseline used for max-drawdown
  // kill switch. When empty, the executor populates system_state.initial_capital
  // from Bybit's reported wallet balance on first boot.
  INITIAL_CAPITAL_USDT_OVERRIDE: z.coerce.number().nonnegative().default(0),

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
