import { db } from "../db/client.js";
import { configTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";

// Default values, applied by `seedDefaults()` on boot when the table is empty.
// Keys mirror spec section 6 (Mutable config) — units are already encoded
// in the keys themselves (PCT, MIN, USDT).
export const CONFIG_DEFAULTS: Record<string, string> = {
  MAX_RISK_PCT: "2.0",
  MAX_LEVERAGE: "10",
  MAX_OPEN_POSITIONS: "3",
  DAILY_LOSS_LIMIT_PCT: "10.0",
  MAX_DRAWDOWN_PCT: "30.0",
  COOLDOWN_MIN_AFTER_LOSS: "30",
  CHASE_TOLERANCE_PCT: "0.5",
  CHASE_TIMEOUT_MIN: "10",
  MIN_RR_RATIO: "0.5",
  WHITELIST_SYMBOLS: "BTCUSDT,ETHUSDT",
  DRY_RUN: "true",
};

// Validation rules used by the PUT endpoint in server.ts. Min/max are
// inclusive bounds; sets are exhaustive allowed values; bool accepts the two
// strings.
type Validator =
  | { kind: "number"; min: number; max: number }
  | { kind: "bool" }
  | { kind: "csv" };

export const CONFIG_VALIDATORS: Record<string, Validator> = {
  MAX_RISK_PCT: { kind: "number", min: 0.1, max: 5 },
  MAX_LEVERAGE: { kind: "number", min: 1, max: 20 },
  MAX_OPEN_POSITIONS: { kind: "number", min: 1, max: 10 },
  DAILY_LOSS_LIMIT_PCT: { kind: "number", min: 1, max: 50 },
  MAX_DRAWDOWN_PCT: { kind: "number", min: 5, max: 80 },
  COOLDOWN_MIN_AFTER_LOSS: { kind: "number", min: 0, max: 1440 },
  CHASE_TOLERANCE_PCT: { kind: "number", min: 0, max: 5 },
  CHASE_TIMEOUT_MIN: { kind: "number", min: 1, max: 60 },
  MIN_RR_RATIO: { kind: "number", min: 0.1, max: 10 },
  WHITELIST_SYMBOLS: { kind: "csv" },
  DRY_RUN: { kind: "bool" },
};

export function validateConfigValue(key: string, value: string): string | null {
  const v = CONFIG_VALIDATORS[key];
  if (!v) return `Unknown key ${key}`;
  if (v.kind === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Not a number";
    if (n < v.min || n > v.max) return `Out of range [${v.min}, ${v.max}]`;
  } else if (v.kind === "bool") {
    if (value !== "true" && value !== "false") return "Must be 'true' or 'false'";
  } else if (v.kind === "csv") {
    if (value.length === 0) return "Empty CSV";
  }
  return null;
}

export async function seedDefaults(): Promise<void> {
  const existing = await db.select({ key: configTable.key }).from(configTable);
  const have = new Set(existing.map((r) => r.key));
  const missing = Object.entries(CONFIG_DEFAULTS).filter(([k]) => !have.has(k));
  if (missing.length === 0) return;
  await db
    .insert(configTable)
    .values(missing.map(([key, value]) => ({ key, value })));
  logger.info("Seeded config defaults", { count: missing.length, keys: missing.map(([k]) => k) });
}

export async function getConfig(key: string): Promise<string> {
  const rows = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .limit(1);
  const v = rows[0]?.value;
  if (v !== undefined) return v;
  const def = CONFIG_DEFAULTS[key];
  if (def !== undefined) return def;
  throw new Error(`Config key ${key} not found and no default`);
}

export async function getConfigNumber(key: string): Promise<number> {
  return Number(await getConfig(key));
}

export async function getConfigBool(key: string): Promise<boolean> {
  return (await getConfig(key)) === "true";
}

export async function getConfigCsv(key: string): Promise<string[]> {
  return (await getConfig(key))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function setConfig(key: string, value: string): Promise<void> {
  const err = validateConfigValue(key, value);
  if (err) throw new Error(`Invalid value for ${key}: ${err}`);
  await db
    .insert(configTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: configTable.key, set: { value, updatedAt: new Date() } });
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(configTable);
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}
