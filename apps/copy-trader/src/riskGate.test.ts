import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluateRiskGate, type GateContext, type GateSignal } from "./riskGate.js";

const baseSignal: GateSignal = {
  signalHash: "h1",
  direction: "SHORT",
  symbol: "BTCUSDT",
  entryLow: 79400,
  entryHigh: 79900,
  stopLoss: 83000,
  takeProfit1: 76400,
  leverageRaw: 15,
};

function ctx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    config: {
      MAX_OPEN_POSITIONS: 3,
      DAILY_LOSS_LIMIT_PCT: 10,
      MAX_DRAWDOWN_PCT: 30,
      CHASE_TOLERANCE_PCT: 0.5,
      MIN_RR_RATIO: 0.5,
      WHITELIST_SYMBOLS: ["BTCUSDT", "ETHUSDT"],
    },
    state: {
      killed: false,
      killedReason: null,
      cooldownUntil: null,
      initialCapital: 1000,
    },
    balance: 1000,
    openCount: 0,
    dayPnl: 0,
    dayBalanceStart: 1000,
    lastPrice: 79600, // inside the range
    now: new Date("2026-05-18T18:00:00Z"),
    ...overrides,
  };
}

describe("evaluateRiskGate", () => {
  it("passes a clean SHORT inside the entry range with MARKET entry", () => {
    const r = evaluateRiskGate(baseSignal, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryStrategy).toBe("MARKET");
  });

  it("returns LIMIT_CHASE when price is within tolerance but outside range (SHORT)", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ lastPrice: 80100 })); // 0.25% above high
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryStrategy).toBe("LIMIT_CHASE");
    expect(r.limitPrice).toBe(79900);
  });

  it("rejects when price is past the chase tolerance", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ lastPrice: 81000 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("PRICE_TOO_FAR");
  });

  it("rejects when kill switch is active", () => {
    const r = evaluateRiskGate(
      baseSignal,
      ctx({ state: { killed: true, killedReason: "TEST", cooldownUntil: null, initialCapital: 1000 } })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("KILL_SWITCH_ACTIVE");
  });

  it("rejects symbol not in whitelist", () => {
    const r = evaluateRiskGate({ ...baseSignal, symbol: "1000PEPEUSDT" }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("SYMBOL_NOT_WHITELISTED");
  });

  it("rejects when in cooldown", () => {
    const r = evaluateRiskGate(
      baseSignal,
      ctx({
        state: {
          killed: false,
          killedReason: null,
          cooldownUntil: new Date("2026-05-18T19:00:00Z"),
          initialCapital: 1000,
        },
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("COOLDOWN_AFTER_LOSS");
  });

  it("rejects when at max open positions", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ openCount: 3 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("MAX_OPEN_POSITIONS");
  });

  it("rejects when daily loss limit hit", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ dayPnl: -150 })); // -15% of 1000
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("DAILY_LOSS_LIMIT");
  });

  it("trips KILL_SWITCH_DRAWDOWN when balance fell past max drawdown", () => {
    const r = evaluateRiskGate(baseSignal, ctx({ balance: 600 })); // 40% drawdown vs initialCapital 1000
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("KILL_SWITCH_DRAWDOWN");
  });

  it("rejects directional incoherence (SHORT with SL below entry)", () => {
    const r = evaluateRiskGate(
      { ...baseSignal, stopLoss: 79000 },
      ctx()
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("INVALID_SIGNAL_SL");
  });

  it("rejects low reward:risk ratio", () => {
    // SHORT entry ~79650, SL 83000 → risk 3350. TP at 79640 → reward 10 → R:R 0.003
    const r = evaluateRiskGate({ ...baseSignal, takeProfit1: 79640 }, ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("RR_TOO_LOW");
  });
});
