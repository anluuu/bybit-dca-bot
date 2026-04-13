import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runBacktest,
  type DailyPoint,
  type FearGreedPoint,
  type BacktestResult,
} from "./replay.js";

/**
 * Backtest CLI — runs the signal-weighted DCA against flat DCA over a
 * user-supplied historical price series.
 *
 * Usage:
 *   pnpm --filter @dca/bot backtest \
 *     --btc-csv ./data/btcbrl-daily.csv \
 *     --fg-csv  ./data/feargreed.csv \
 *     --start   2020-01-01 \
 *     --end     2025-12-31 \
 *     --weekly  250 \
 *     --cap     1000
 *
 * CSV formats (header row required, UTF-8):
 *   btc-csv: `date,close` — date is ISO "YYYY-MM-DD" (UTC), close is BRL
 *   fg-csv:  `date,value` — value is 0..100 integer
 *
 * Where to get the data:
 *   - BTC/BRL daily closes: Bybit `/v5/market/kline` supports historical
 *     queries; if BTCBRL depth is shallow, derive BRL from BTC/USD × USD/BRL
 *     (BTC/USD from CryptoCompare or CoinGecko; BRL/USD from exchangerate.host).
 *   - Fear & Greed history: `https://api.alternative.me/fng/?limit=0` returns
 *     the complete series.
 *
 * The harness is intentionally dumb about data acquisition — generating the
 * CSVs is a one-shot chore and bundling a scraper here would couple backtests
 * to external API rate limits.
 */

interface CliArgs {
  btcCsv: string;
  fgCsv: string;
  start: string;
  end: string;
  weekly: number;
  cap: number;
  minOrder: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value) args[key] = value;
  }

  const required = ["btc-csv", "start", "end"];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing required --${k}`);
      process.exit(1);
    }
  }

  return {
    btcCsv: resolve(args["btc-csv"]),
    fgCsv: args["fg-csv"] ? resolve(args["fg-csv"]) : "",
    start: args.start,
    end: args.end,
    weekly: parseFloat(args.weekly ?? "250"),
    cap: parseFloat(args.cap ?? "1000"),
    minOrder: parseFloat(args["min-order"] ?? "10"),
  };
}

function loadDailyCsv(path: string): DailyPoint[] {
  const text = readFileSync(path, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Skip header
  const rows = lines.slice(1);
  const out: DailyPoint[] = [];
  for (const row of rows) {
    const [date, close] = row.split(",");
    const price = parseFloat(close);
    if (!Number.isFinite(price)) continue;
    out.push({ date: date.trim(), close: price });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function loadFearGreedCsv(path: string): FearGreedPoint[] {
  if (!path) return [];
  const text = readFileSync(path, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = lines.slice(1);
  const out: FearGreedPoint[] = [];
  for (const row of rows) {
    const [date, value] = row.split(",");
    const v = parseInt(value, 10);
    if (!Number.isFinite(v)) continue;
    out.push({ date: date.trim(), value: v });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function fmtBrl(v: number): string {
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function renderReport(args: CliArgs, result: BacktestResult): string {
  const { flat, modulated, btcDelta, avgPriceDelta } = result;
  const btcDeltaPct = flat.totalBtc > 0 ? (btcDelta / flat.totalBtc) * 100 : 0;

  // Verdict against the pass gate from the design:
  //   modulated ≥ flat total sats, drawdown no worse than flat + 5%.
  const gateSatsOk = modulated.totalBtc >= flat.totalBtc;
  const gateDrawdownOk =
    modulated.maxDrawdownPct <= flat.maxDrawdownPct + 5;
  const verdict =
    gateSatsOk && gateDrawdownOk ? "✓ PASS" : "✗ FAIL";

  return `
# DCA Backtest — ${args.start} → ${args.end}

**Parameters**
- Weekly baseline: R$ ${fmtBrl(args.weekly)}
- Monthly cap: R$ ${fmtBrl(args.cap)}
- Min order: R$ ${fmtBrl(args.minOrder)}

## Results

| Metric                     |       Flat       |     Modulated    | Δ           |
|----------------------------|-----------------:|-----------------:|-------------|
| Total spent (BRL)          | ${fmtBrl(flat.totalSpent).padStart(16)} | ${fmtBrl(modulated.totalSpent).padStart(16)} | ${fmtBrl(modulated.totalSpent - flat.totalSpent)} |
| Total BTC                  | ${flat.totalBtc.toFixed(8).padStart(16)} | ${modulated.totalBtc.toFixed(8).padStart(16)} | ${btcDelta >= 0 ? "+" : ""}${btcDelta.toFixed(8)} (${btcDeltaPct.toFixed(2)}%) |
| Avg price (R$/BTC)         | ${fmtBrl(flat.avgPrice).padStart(16)} | ${fmtBrl(modulated.avgPrice).padStart(16)} | ${avgPriceDelta >= 0 ? "+" : ""}${fmtBrl(avgPriceDelta)} |
| Cap utilization (%)        | ${flat.capUtilizationPct.toFixed(1).padStart(16)} | ${modulated.capUtilizationPct.toFixed(1).padStart(16)} | — |
| Max drawdown (%)           | ${flat.maxDrawdownPct.toFixed(2).padStart(16)} | ${modulated.maxDrawdownPct.toFixed(2).padStart(16)} | — |
| Weeks filled               | ${flat.buys.filter((b) => b.skippedReason === "none").length.toString().padStart(16)} | ${modulated.buys.filter((b) => b.skippedReason === "none").length.toString().padStart(16)} | — |
| Weeks skipped (cap)        | ${flat.buys.filter((b) => b.skippedReason === "skipped_cap").length.toString().padStart(16)} | ${modulated.buys.filter((b) => b.skippedReason === "skipped_cap").length.toString().padStart(16)} | — |

## Gate

- Sats ≥ flat:            ${gateSatsOk ? "✓" : "✗"}
- Drawdown ≤ flat + 5pp:  ${gateDrawdownOk ? "✓" : "✗"}

**${verdict}** — ${
    verdict === "✓ PASS"
      ? "modulation beats flat DCA; safe to ship"
      : "modulation did NOT beat flat DCA; do not ship without tuning the multiplier curve or breakpoints"
  }
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(`Loading ${args.btcCsv}…`);
  const dailyPrices = loadDailyCsv(args.btcCsv);
  const fearGreed = loadFearGreedCsv(args.fgCsv);
  console.error(
    `Loaded ${dailyPrices.length} daily BTC bars, ${fearGreed.length} FG readings`
  );

  const result = runBacktest({
    dailyPrices,
    fearGreed,
    start: new Date(args.start + "T00:00:00Z"),
    end: new Date(args.end + "T23:59:59Z"),
    weeklyBrl: args.weekly,
    monthlyCapBrl: args.cap,
    minOrderBrl: args.minOrder,
  });

  console.log(renderReport(args, result));
}

main();
