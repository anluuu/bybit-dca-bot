import type { ExecutorSignal } from "./executor.js";
import type { InstrumentSpec } from "../infra/instrumentInfo.js";

export type ReplayableSignalRow = {
  id: string;
  signalHash: string;
  direction: string | null;
  symbol: string | null;
  entryLow: string | null;
  entryHigh: string | null;
  stopLoss: string | null;
  takeProfit1: string | null;
  leverageRaw: number | null;
};

function requiredNumber(value: string | number | null, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field}`);
  return parsed;
}

function requiredString(value: string | null, field: string): string {
  if (!value) throw new Error(`Invalid ${field}`);
  return value;
}

export function simulatedEntryPrice(signal: Pick<ReplayableSignalRow, "entryLow" | "entryHigh">): number {
  return (
    requiredNumber(signal.entryLow, "entryLow") + requiredNumber(signal.entryHigh, "entryHigh")
  ) / 2;
}

export function signalToExecutorSignal(signal: ReplayableSignalRow): ExecutorSignal {
  const direction = requiredString(signal.direction, "direction");
  if (direction !== "LONG" && direction !== "SHORT") throw new Error("Invalid direction");

  return {
    signalId: signal.id,
    signalHash: signal.signalHash,
    direction,
    symbol: requiredString(signal.symbol, "symbol"),
    entryLow: requiredNumber(signal.entryLow, "entryLow"),
    entryHigh: requiredNumber(signal.entryHigh, "entryHigh"),
    stopLoss: requiredNumber(signal.stopLoss, "stopLoss"),
    takeProfit1: requiredNumber(signal.takeProfit1, "takeProfit1"),
    leverageRaw: requiredNumber(signal.leverageRaw, "leverageRaw"),
  };
}

export function replayInstrumentSpec(symbol: string): InstrumentSpec {
  switch (symbol) {
    case "BTCUSDT":
      return { symbol, qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100, tickSize: 0.1 };
    case "ETHUSDT":
      return { symbol, qtyStep: 0.01, minOrderQty: 0.01, maxOrderQty: 1000, tickSize: 0.01 };
    case "SOLUSDT":
      return { symbol, qtyStep: 0.1, minOrderQty: 0.1, maxOrderQty: 10000, tickSize: 0.01 };
    default:
      return { symbol, qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100, tickSize: 0.01 };
  }
}
