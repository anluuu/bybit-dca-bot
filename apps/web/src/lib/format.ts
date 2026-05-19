import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import advancedFormat from "dayjs/plugin/advancedFormat";
import localizedFormat from "dayjs/plugin/localizedFormat";
import "dayjs/locale/pt-br";
import "dayjs/locale/en";
import { i18n } from "./i18n.ts";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);
dayjs.extend(localizedFormat);

/**
 * Per-locale display timezone. The bot stores everything in UTC, but humans
 * read the dashboard in their own wall clock — pt-BR viewers expect
 * America/Sao_Paulo; en viewers we keep on UTC to match server logs.
 */
const DISPLAY_TZ: Record<string, string> = {
  "pt-BR": "America/Sao_Paulo",
  en: "UTC",
};

function displayTz(): string {
  return DISPLAY_TZ[currentLocale()] ?? "UTC";
}

function dayjsLocale(): string {
  return currentLocale() === "pt-BR" ? "pt-br" : "en";
}

/**
 * Centralized locale-aware formatters. Every component should route number,
 * currency, and date rendering through these helpers — never call
 * `toLocaleString` / `toLocaleDateString` directly. Switching the active
 * locale must flip the entire dashboard atomically.
 *
 * Currency is always BRL (the bot trades BRL pairs). Only the visual format
 * changes between locales (R$ 1.234,56 in pt-BR, R$ 1,234.56 in en).
 */

function currentLocale(): string {
  return i18n.language || "pt-BR";
}

export function formatCurrency(
  value: number,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {}
): string {
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = opts;
  return new Intl.NumberFormat(currentLocale(), {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/** Currency without decimals — used for tight spots (chart axes, stat cards). */
export function formatCurrencyCompact(value: number): string {
  return formatCurrency(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** BTC amount with 8 fractional digits (satoshi precision). */
export function formatBtc(value: number, digits = 8): string {
  return new Intl.NumberFormat(currentLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatNumber(
  value: number,
  opts: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(currentLocale(), opts).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return new Intl.NumberFormat(currentLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Render timestamps in the viewer's display timezone (see DISPLAY_TZ). Bot
 * stores UTC; dashboard viewers read wall clock. dayjs handles DST transitions
 * and the short TZ label ("z") so we don't hand-roll the abbreviation. Past
 * bug: the table said 15:29 while Brazil was at 12:29 because formatters were
 * pinned to UTC with a hardcoded " UTC" suffix.
 */

/** e.g. "19/04/2026 12:29 BRT" (pt-BR) / "Apr 19, 2026 3:29 PM UTC" (en). */
export function formatDateTime(iso: string | Date): string {
  return dayjs(iso).tz(displayTz()).locale(dayjsLocale()).format("L LT z");
}

/** Short date for chart axis ticks — "19 de abr." (pt-BR) / "Apr 19" (en). */
export function formatDateShort(iso: string | Date): string {
  const fmt = currentLocale() === "pt-BR" ? "DD [de] MMM" : "MMM D";
  return dayjs(iso).tz(displayTz()).locale(dayjsLocale()).format(fmt);
}

/** "domingo, 26 de abril de 2026, 05:00 BRT" — used for the "next buy" label. */
export function formatNextBuy(iso: string | Date): string {
  return dayjs(iso).tz(displayTz()).locale(dayjsLocale()).format("LLLL [·] z");
}

/** Tailwind class for green/red/neutral signed-number tone. */
export function pnlTone(n: number): string {
  if (n > 0) return "text-green-gain";
  if (n < 0) return "text-red-loss";
  return "text-surface-300";
}
