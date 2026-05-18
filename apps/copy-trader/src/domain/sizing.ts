import type { InstrumentSpec } from "../infra/instrumentInfo.js";

export type SizingInput = {
  balanceUsdt: number;
  maxRiskPct: number;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  leverageUsed: number;
  instrument: InstrumentSpec;
};

export type SizingResult =
  | {
      kind: "ok";
      qty: number;
      positionUsdt: number;
      marginUsdt: number;
      slDistancePct: number;
    }
  | { kind: "error"; reason: "SL_AT_ENTRY" | "BALANCE_TOO_SMALL" };

function quantizeFloor(value: number, step: number): number {
  if (step <= 0) return value;
  const factor = 1 / step;
  return Math.floor(value * factor) / factor;
}

export function computePositionPlan(input: SizingInput): SizingResult {
  const { balanceUsdt, maxRiskPct, entryPrice, stopLoss, leverageUsed, instrument } = input;

  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance === 0) return { kind: "error", reason: "SL_AT_ENTRY" };
  const slDistancePct = slDistance / entryPrice;

  const riskUsdt = balanceUsdt * (maxRiskPct / 100);
  const rawPositionUsdt = riskUsdt / slDistancePct;
  const rawQty = rawPositionUsdt / entryPrice;

  const cappedQty = Math.min(rawQty, instrument.maxOrderQty);
  const qty = quantizeFloor(cappedQty, instrument.qtyStep);

  if (qty < instrument.minOrderQty) {
    return { kind: "error", reason: "BALANCE_TOO_SMALL" };
  }

  const positionUsdt = qty * entryPrice;
  const marginUsdt = positionUsdt / leverageUsed;

  return { kind: "ok", qty, positionUsdt, marginUsdt, slDistancePct };
}
