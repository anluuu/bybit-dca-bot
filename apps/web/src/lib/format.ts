import { i18n } from "./i18n.ts";

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

/** "12/01/2026 08:00 UTC" (pt-BR) or "Jan 12, 2026, 08:00 UTC" (en). */
export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (
    new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
}

/** Short date for chart axis ticks — "12 jan" (pt-BR) / "Jan 12" (en). */
export function formatDateShort(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** "domingo, 19 de abril de 2026, 08:00 UTC" — used for the "next buy" label. */
export function formatNextBuy(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return (
    new Intl.DateTimeFormat(currentLocale(), {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
}
