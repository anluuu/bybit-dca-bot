import { describe, expect, it } from "vitest";
import { computePositionPlan } from "./sizing.js";

describe("computePositionPlan", () => {
  const spec = { symbol: "BTCUSDT", qtyStep: 0.001, minOrderQty: 0.001, maxOrderQty: 100, tickSize: 0.1 };

  it("sizes a SHORT so SL distance equals the risk budget", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000, // 5% above entry → SL distance 5%
      leverageUsed: 10,
      instrument: spec,
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    // risk = 1000 * 2% = 20 USDT; position = 20 / 0.05 = 400 USDT;
    // qty = 400 / 80000 = 0.005 BTC; quantized to step 0.001 = 0.005
    expect(plan.qty).toBeCloseTo(0.005, 6);
    expect(plan.positionUsdt).toBeCloseTo(400, 4);
    expect(plan.marginUsdt).toBeCloseTo(40, 4); // 400 / 10x
  });

  it("rounds qty DOWN to the symbol's qtyStep", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "LONG",
      entryPrice: 80000,
      stopLoss: 76000, // 5%
      leverageUsed: 10,
      instrument: { ...spec, qtyStep: 0.01 },
    });
    // raw qty 0.005, qtyStep 0.01 → quantized 0.00 → below minOrderQty (0.001)
    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.reason).toBe("BALANCE_TOO_SMALL");
  });

  it("rejects when the quantized qty is below minOrderQty", () => {
    const plan = computePositionPlan({
      balanceUsdt: 10, // very small
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000,
      leverageUsed: 10,
      instrument: spec,
    });
    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.reason).toBe("BALANCE_TOO_SMALL");
  });

  it("rejects when entry equals SL (zero risk distance)", () => {
    const plan = computePositionPlan({
      balanceUsdt: 1000,
      maxRiskPct: 2,
      direction: "LONG",
      entryPrice: 80000,
      stopLoss: 80000,
      leverageUsed: 10,
      instrument: spec,
    });
    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.reason).toBe("SL_AT_ENTRY");
  });

  it("clamps qty at maxOrderQty when the budget exceeds it", () => {
    const plan = computePositionPlan({
      balanceUsdt: 10_000_000, // absurd
      maxRiskPct: 2,
      direction: "SHORT",
      entryPrice: 80000,
      stopLoss: 84000,
      leverageUsed: 10,
      instrument: { ...spec, maxOrderQty: 1 },
    });
    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;
    expect(plan.qty).toBe(1);
  });
});
