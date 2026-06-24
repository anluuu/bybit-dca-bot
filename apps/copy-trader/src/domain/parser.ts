import { createHash } from "node:crypto";

export type SignalIntent = {
  direction: "LONG" | "SHORT";
  symbol: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  leverageRaw: number;
  takeProfit1: number;
  takeProfit2?: number;
  takeProfit3?: number;
  rawText: string;
  signalHash: string;
  telegramMsgId: number;
};

export type ParseResult =
  | { kind: "ok"; intent: SignalIntent }
  | { kind: "error"; reason: string; rawText: string; signalHash: string; telegramMsgId: number };

/**
 * Normalize the signaler's quirks before regex:
 *   - "0. 0.00385" (stray "0. " typo) → "0.00385"
 *   - "79.400" (BR thousands separator on values >= 1000) → "79400"
 *     The signaler mixes BR-style "79.400" (means 79400) and US-style "0.00385"
 *     (means 0.00385). Rule: if a number has a single dot followed by exactly
 *     three digits AND the integer part is >= 1, treat the dot as thousands.
 */
function normalizeText(input: string): string {
  let out = input.replace(/(\b\d+\.)\s+(\d+\.\d+)/g, "$2"); // strip "0. " typo
  out = out.replace(
    /\b(\d{1,3})\.(\d{3})\b(?!\.)/g,
    (_, intPart: string, frac: string) => {
      const n = Number(intPart);
      if (n >= 1) return `${intPart}${frac}`;
      return `${intPart}.${frac}`;
    }
  );
  return out;
}

function parseNumber(s: string): number | undefined {
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : undefined;
}

// Static symbol mapping (extend as the signaler introduces new tickers).
const SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  "1000PEPE": "1000PEPEUSDT",
  "1000SHIB": "1000SHIBUSDT",
  "1000BONK": "1000BONKUSDT",
};

function mapSymbol(raw: string): string | undefined {
  const upper = raw.toUpperCase();
  return SYMBOL_MAP[upper];
}

export function parseSignal(rawText: string, telegramMsgId: number): ParseResult {
  const signalHash = createHash("sha256").update(rawText).digest("hex");
  const normalized = normalizeText(rawText);

  const directionMatch = normalized.match(/(?:#\w+\s+)?(LONG|SHORT)\s+([A-Z0-9]+)/);
  if (!directionMatch) {
    return { kind: "error", reason: "NO_DIRECTION_OR_SYMBOL", rawText, signalHash, telegramMsgId };
  }
  const direction = directionMatch[1] as "LONG" | "SHORT";
  const symbol = mapSymbol(directionMatch[2]);
  if (!symbol) {
    return {
      kind: "error",
      reason: `UNKNOWN_SYMBOL:${directionMatch[2]}`,
      rawText,
      signalHash,
      telegramMsgId,
    };
  }

  const entryMatch = normalized.match(/Entrada:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)/i);
  if (!entryMatch) {
    return { kind: "error", reason: "NO_ENTRY", rawText, signalHash, telegramMsgId };
  }
  const e1 = parseNumber(entryMatch[1]);
  const e2 = parseNumber(entryMatch[2]);
  if (e1 === undefined || e2 === undefined) {
    return { kind: "error", reason: "INVALID_ENTRY_NUMBERS", rawText, signalHash, telegramMsgId };
  }
  const entryLow = Math.min(e1, e2);
  const entryHigh = Math.max(e1, e2);

  const slMatch = normalized.match(/SL:\s*([0-9.]+)/i);
  if (!slMatch) {
    return { kind: "error", reason: "NO_SL", rawText, signalHash, telegramMsgId };
  }
  const stopLoss = parseNumber(slMatch[1]);
  if (stopLoss === undefined) {
    return { kind: "error", reason: "INVALID_SL", rawText, signalHash, telegramMsgId };
  }

  const levMatch = normalized.match(/Alavancagem:\s*(\d+)(?:x)?(?:\s*[-–]\s*(\d+)x)?/i);
  if (!levMatch) {
    return { kind: "error", reason: "NO_LEVERAGE", rawText, signalHash, telegramMsgId };
  }
  const leverageRaw = Number(levMatch[1]);
  if (!Number.isFinite(leverageRaw) || leverageRaw <= 0) {
    return { kind: "error", reason: "INVALID_LEVERAGE", rawText, signalHash, telegramMsgId };
  }

  // TPs: handle duplicate labels (signaler sometimes types "TP3:" twice) by
  // keeping the first occurrence of each ordinal we encounter.
  const tps = new Map<number, number>();
  const tpRegex = /TP(\d):\s*([0-9.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tpRegex.exec(normalized)) !== null) {
    const ord = Number(m[1]);
    const v = parseNumber(m[2]);
    if (v !== undefined && !tps.has(ord)) tps.set(ord, v);
  }
  const tp1 = tps.get(1);
  if (tp1 === undefined) {
    return { kind: "error", reason: "NO_TP1", rawText, signalHash, telegramMsgId };
  }

  // Directional coherence: LONG SL must be below entryLow; SHORT SL above entryHigh.
  if (direction === "LONG" && stopLoss >= entryLow) {
    return { kind: "error", reason: "SL_NOT_BELOW_ENTRY_FOR_LONG", rawText, signalHash, telegramMsgId };
  }
  if (direction === "SHORT" && stopLoss <= entryHigh) {
    return { kind: "error", reason: "SL_NOT_ABOVE_ENTRY_FOR_SHORT", rawText, signalHash, telegramMsgId };
  }

  return {
    kind: "ok",
    intent: {
      direction,
      symbol,
      entryLow,
      entryHigh,
      stopLoss,
      leverageRaw,
      takeProfit1: tp1,
      takeProfit2: tps.get(2),
      takeProfit3: tps.get(3),
      rawText,
      signalHash,
      telegramMsgId,
    },
  };
}
