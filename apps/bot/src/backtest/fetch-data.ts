import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Fetch historical data needed by the backtest harness from free public APIs
 * and write two CSVs ready for `pnpm --filter @dca/bot backtest`.
 *
 * Sources:
 *   - BTC/USD daily closes: CryptoCompare (no key, ~2000 days/call, paginated)
 *   - USD/BRL daily rates:  Frankfurter (ECB-based, no key, weekdays only)
 *   - Fear & Greed index:   alternative.me (no key, complete history in one call)
 *
 * BTC/BRL is derived: BTC/USD × USD/BRL per date. FX is carried forward over
 * weekends (Frankfurter returns weekdays only). FG values published after the
 * market close on day D are aligned to day D.
 *
 * Usage:
 *   pnpm --filter @dca/bot fetch-backtest-data \
 *     --start 2020-01-01 --end 2026-04-13 --out ./data
 */

// --- CLI parsing --------------------------------------------------------

interface Args {
  start: string;
  end: string;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) args[key] = value;
  }
  if (!args.start || !args.end) {
    console.error(
      "Usage: fetch-backtest-data --start YYYY-MM-DD --end YYYY-MM-DD [--out ./data]"
    );
    process.exit(1);
  }
  return {
    start: args.start,
    end: args.end,
    outDir: resolve(args.out ?? "./data"),
  };
}

// --- Shared helpers -----------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dateFromYmd(s: string): Date {
  return new Date(s + "T00:00:00Z");
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Minimal typed fetch wrapper. Node 20+ has global `fetch`. We throw on
 * non-2xx so the caller sees it in the CLI output.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// --- BTC/USD via CryptoCompare -----------------------------------------

interface CryptoCompareResponse {
  Response: string;
  Message?: string;
  Data: {
    TimeFrom: number;
    TimeTo: number;
    Data: Array<{ time: number; close: number }>;
  };
}

/**
 * CryptoCompare caps each call to ~2000 days. Paginate backwards by updating
 * `toTs` to the oldest timestamp we've seen, until we're past `start`.
 */
async function fetchBtcUsdDaily(
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const byDate = new Map<string, number>();
  const startUnix = Math.floor(start.getTime() / 1000);
  let toTs = Math.floor(end.getTime() / 1000);

  // Safety bound: at 2000 days/call, 10 calls covers ~55 years — plenty.
  for (let page = 0; page < 10; page++) {
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000&toTs=${toTs}`;
    const json = await fetchJson<CryptoCompareResponse>(url);
    if (json.Response !== "Success") {
      throw new Error(`CryptoCompare error: ${json.Message ?? "unknown"}`);
    }
    const page_ = json.Data.Data;
    if (page_.length === 0) break;

    for (const row of page_) {
      if (row.close === 0) continue; // missing bar, skip
      const date = ymd(new Date(row.time * 1000));
      if (!byDate.has(date)) byDate.set(date, row.close);
    }

    const oldest = page_[0].time;
    if (oldest <= startUnix) break;
    toTs = oldest - 1;
  }

  return byDate;
}

// --- USD/BRL via Frankfurter (ECB) -------------------------------------

interface FrankfurterResponse {
  rates: Record<string, { BRL: number }>;
}

async function fetchUsdBrlDaily(
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const url = `https://api.frankfurter.app/${ymd(start)}..${ymd(end)}?from=USD&to=BRL`;
  const json = await fetchJson<FrankfurterResponse>(url);

  const byDate = new Map<string, number>();
  for (const [date, entry] of Object.entries(json.rates)) {
    byDate.set(date, entry.BRL);
  }
  return byDate;
}

/**
 * Frankfurter only publishes business days. Walk forward through the calendar
 * and carry forward the last-known rate over weekends and holidays.
 */
function fillGapsForward(
  rates: Map<string, number>,
  start: Date,
  end: Date
): Map<string, number> {
  const filled = new Map<string, number>();
  let lastRate: number | null = null;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = ymd(d);
    const today = rates.get(key);
    if (today !== undefined) lastRate = today;
    if (lastRate !== null) filled.set(key, lastRate);
  }
  return filled;
}

// --- Fear & Greed via alternative.me -----------------------------------

interface AlternativeMeResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string; // unix seconds as string
  }>;
}

async function fetchFearGreedAll(): Promise<Map<string, number>> {
  const json = await fetchJson<AlternativeMeResponse>(
    "https://api.alternative.me/fng/?limit=0"
  );
  const byDate = new Map<string, number>();
  for (const row of json.data) {
    const date = ymd(new Date(parseInt(row.timestamp, 10) * 1000));
    byDate.set(date, parseInt(row.value, 10));
  }
  return byDate;
}

// --- CSV writers --------------------------------------------------------

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeCsv(
  path: string,
  header: string,
  rows: Array<[string, number]>
): void {
  ensureDir(path);
  const body = rows
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => `${date},${value}`)
    .join("\n");
  writeFileSync(path, `${header}\n${body}\n`);
}

// --- Main ---------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = dateFromYmd(args.start);
  const end = dateFromYmd(args.end);

  console.error(`Range: ${args.start} → ${args.end}`);
  console.error(`Output: ${args.outDir}`);

  // Fetch all three sources in parallel — they don't depend on each other.
  console.error("\nFetching…");
  console.error("  • BTC/USD daily (CryptoCompare, paginated)");
  console.error("  • USD/BRL daily (Frankfurter / ECB)");
  console.error("  • Fear & Greed full history (alternative.me)");

  const [btcUsd, usdBrlRaw, fg] = await Promise.all([
    fetchBtcUsdDaily(start, end),
    fetchUsdBrlDaily(start, end),
    fetchFearGreedAll(),
  ]);

  const usdBrl = fillGapsForward(usdBrlRaw, start, end);

  console.error(
    `  → ${btcUsd.size} BTC/USD closes, ${usdBrl.size} USD/BRL rates, ${fg.size} F&G readings`
  );

  // --- Derive BTC/BRL ---------------------------------------------------
  const btcBrl: Array<[string, number]> = [];
  let missingFx = 0;
  let missingBtc = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const date = ymd(d);
    const usd = btcUsd.get(date);
    const fx = usdBrl.get(date);
    if (usd === undefined) {
      missingBtc++;
      continue;
    }
    if (fx === undefined) {
      missingFx++;
      continue;
    }
    btcBrl.push([date, Number((usd * fx).toFixed(2))]);
  }

  if (missingBtc > 0) {
    console.error(`  ⚠ ${missingBtc} days missing BTC/USD (before listing?)`);
  }
  if (missingFx > 0) {
    console.error(`  ⚠ ${missingFx} days missing FX (before range start?)`);
  }

  // --- Slice F&G to range -----------------------------------------------
  const fgRows: Array<[string, number]> = [];
  for (const [date, value] of fg.entries()) {
    if (date >= args.start && date <= args.end) fgRows.push([date, value]);
  }

  // --- Write CSVs -------------------------------------------------------
  const btcPath = resolve(args.outDir, "btcbrl-daily.csv");
  const fgPath = resolve(args.outDir, "feargreed.csv");

  writeCsv(btcPath, "date,close", btcBrl);
  writeCsv(fgPath, "date,value", fgRows);

  console.error(`\n✓ Wrote ${btcBrl.length} BTC/BRL rows → ${btcPath}`);
  console.error(`✓ Wrote ${fgRows.length} F&G rows    → ${fgPath}`);
  console.error(`\nNow run:`);
  console.error(
    `  pnpm --filter @dca/bot backtest --btc-csv ${btcPath} --fg-csv ${fgPath} --start ${args.start} --end ${args.end} --weekly 250 --cap 1000`
  );
}

main().catch((err) => {
  console.error("Fetch failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
