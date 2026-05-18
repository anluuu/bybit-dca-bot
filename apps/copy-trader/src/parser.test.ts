import { describe, expect, it } from "vitest";
import { parseSignal } from "./parser.js";

describe("parseSignal — happy paths", () => {
  it("parses SHORT BTC with #mack tag and entry range", () => {
    const text = `#mack SHORT BTC 🔽

Entrada: 79.400 - 79.900
SL: 83.000

Alavancagem: 15x - 20x

TP1: 76400
TP2: 73.850
TP3: 70.800
TP3: 68.000
Ordem ativa já preenchida`;

    const result = parseSignal(text, 1234);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.direction).toBe("SHORT");
    expect(result.intent.symbol).toBe("BTCUSDT");
    expect(result.intent.entryLow).toBe(79400);
    expect(result.intent.entryHigh).toBe(79900);
    expect(result.intent.stopLoss).toBe(83000);
    expect(result.intent.leverageRaw).toBe(15);
    expect(result.intent.takeProfit1).toBe(76400);
    expect(result.intent.takeProfit2).toBe(73850);
    expect(result.intent.takeProfit3).toBe(70800);
  });

  it("parses SHORT 1000PEPE despite '0. 0.00385' typo", () => {
    const text = `#mack SHORT 1000PEPE 🔽

Entrada: 0.00383 - 0. 0.00385
SL: 0.003955

Alavancagem: 20x

TP1: 0.00373
TP2: 0.00364
TP3: 0.00353
Ordem ativa já preenchida`;

    const result = parseSignal(text, 1235);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.symbol).toBe("1000PEPEUSDT");
    expect(result.intent.entryLow).toBe(0.00383);
    expect(result.intent.entryHigh).toBe(0.00385);
    expect(result.intent.stopLoss).toBe(0.003955);
    expect(result.intent.leverageRaw).toBe(20);
    expect(result.intent.takeProfit1).toBe(0.00373);
  });

  it("parses LONG BTC with single-value leverage and no #tag prefix", () => {
    const text = `#mack LONG BTC 🔼

Entrada: 69660 - 69500
SL: 68740

Alavancagem: 40x

TP1: 70460
TP2: 70900
TP3: 71570

Ordem ativa já preenchida`;

    const result = parseSignal(text, 1236);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.intent.direction).toBe("LONG");
    expect(result.intent.symbol).toBe("BTCUSDT");
    expect(result.intent.entryLow).toBe(69500); // sorted ascending
    expect(result.intent.entryHigh).toBe(69660);
    expect(result.intent.leverageRaw).toBe(40);
  });

  it("computes a deterministic signal_hash for the same text", () => {
    const text = "SHORT BTC 🔽\nEntrada: 80000 - 81000\nSL: 82000\nAlavancagem: 10x\nTP1: 79000";
    const a = parseSignal(text, 1);
    const b = parseSignal(text, 2); // different msg id, same text
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("expected ok");
    expect(a.intent.signalHash).toBe(b.intent.signalHash);
    expect(a.intent.signalHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("parseSignal — error paths", () => {
  it("rejects when no direction word present", () => {
    const r = parseSignal("Apenas um texto qualquer sem estrutura", 1);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("NO_DIRECTION_OR_SYMBOL");
  });

  it("rejects unknown symbol", () => {
    const r = parseSignal(
      "LONG FAKECOIN\nEntrada: 1 - 2\nSL: 0.5\nAlavancagem: 5x\nTP1: 3",
      1
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toMatch(/^UNKNOWN_SYMBOL:/);
  });

  it("rejects LONG with SL above entry", () => {
    const r = parseSignal(
      "LONG BTC\nEntrada: 100 - 200\nSL: 300\nAlavancagem: 5x\nTP1: 250",
      1
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("SL_NOT_BELOW_ENTRY_FOR_LONG");
  });

  it("rejects SHORT with SL below entry", () => {
    const r = parseSignal(
      "SHORT BTC\nEntrada: 100 - 200\nSL: 50\nAlavancagem: 5x\nTP1: 80",
      1
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("SL_NOT_ABOVE_ENTRY_FOR_SHORT");
  });

  it("rejects when TP1 is missing", () => {
    const r = parseSignal(
      "LONG BTC\nEntrada: 100 - 200\nSL: 90\nAlavancagem: 5x\nTP2: 250",
      1
    );
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.reason).toBe("NO_TP1");
  });
});
