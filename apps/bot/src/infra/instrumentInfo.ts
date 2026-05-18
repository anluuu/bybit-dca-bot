import axios from "axios";
import { logger } from "../logger.js";
import { ExchangeApiError, ExchangeClientError } from "./exchange.js";

export interface InstrumentInfo {
  pair: string;
  tickSize: string;
  basePrecision: string;
  quotePrecision: string;
  minOrderQty: string;
  minOrderAmt: string;
  fetchedAt: number;
}

interface BybitInstrumentsResponse {
  retCode: number;
  retMsg: string;
  result: {
    list: Array<{
      symbol: string;
      priceFilter: { tickSize: string };
      lotSizeFilter: {
        basePrecision: string;
        quotePrecision: string;
        minOrderQty: string;
        minOrderAmt: string;
      };
    }>;
  };
}

const cache = new Map<string, InstrumentInfo>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function getInstrumentInfo(
  pair: string,
  forceRefresh = false
): Promise<InstrumentInfo> {
  const cached = cache.get(pair);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached;
  }

  let data: BybitInstrumentsResponse;
  try {
    const res = await axios.get<BybitInstrumentsResponse>(
      "https://api.bybit.com/v5/market/instruments-info",
      {
        params: { category: "spot", symbol: pair },
        timeout: 10_000,
      }
    );
    data = res.data;
  } catch (error) {
    throw new ExchangeApiError(
      `getInstrumentInfo failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (data.retCode !== 0) {
    throw new ExchangeApiError(
      `getInstrumentInfo: ${data.retMsg} (code: ${data.retCode})`,
      data.retCode
    );
  }

  const entry = data.result.list?.[0];
  if (!entry) {
    throw new ExchangeClientError(`No instrument info for ${pair}`);
  }

  const info: InstrumentInfo = {
    pair,
    tickSize: entry.priceFilter.tickSize,
    basePrecision: entry.lotSizeFilter.basePrecision,
    quotePrecision: entry.lotSizeFilter.quotePrecision,
    minOrderQty: entry.lotSizeFilter.minOrderQty,
    minOrderAmt: entry.lotSizeFilter.minOrderAmt,
    fetchedAt: Date.now(),
  };

  cache.set(pair, info);
  logger.info("Cached instrument info", {
    pair,
    tickSize: info.tickSize,
    basePrecision: info.basePrecision,
    minOrderQty: info.minOrderQty,
    minOrderAmt: info.minOrderAmt,
  });
  return info;
}

export async function warmInstrumentCache(pairs: string[]): Promise<void> {
  await Promise.all(
    pairs.map(async (pair) => {
      try {
        await getInstrumentInfo(pair, true);
      } catch (error) {
        logger.warn("Instrument info warmup failed", {
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );
}

/**
 * Count decimal places in a tick/precision step string. "1" → 0, "0.01" → 2,
 * "0.000001" → 6. Handles scientific notation defensively.
 */
function decimalsFromStep(step: string): number {
  if (!step) return 0;
  if (step.includes("e") || step.includes("E")) {
    const n = Number(step);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.ceil(-Math.log10(n)));
  }
  const dot = step.indexOf(".");
  if (dot < 0) return 0;
  return step.length - dot - 1;
}

/**
 * Round a numeric value DOWN to a multiple of `step` and format with the
 * correct number of decimals. Down-rounding is deliberate: for price, placing
 * a limit slightly below your target is safe; for quantity, buying slightly
 * less than the computed amount keeps the order under the quote budget.
 *
 * Implemented with integer arithmetic to avoid binary-FP drift (e.g.
 * 373843.39 * 100 / 1 landing on 37384338.999999994).
 */
export function roundDownToStep(value: number, step: string): string {
  if (!isFinite(value) || value <= 0) return "0";
  const decimals = decimalsFromStep(step);
  const stepNum = parseFloat(step);
  if (!isFinite(stepNum) || stepNum <= 0) {
    return value.toFixed(decimals);
  }
  const scale = Math.pow(10, decimals);
  const stepScaled = Math.round(stepNum * scale);
  const valueScaled = Math.floor(value * scale);
  const rounded = Math.floor(valueScaled / stepScaled) * stepScaled;
  return (rounded / scale).toFixed(decimals);
}
