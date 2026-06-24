import { describe, expect, it } from "vitest";
import { replayInstrumentSpec, signalToExecutorSignal, simulatedEntryPrice } from "./replayParsed.js";

describe("replayParsed helpers", () => {
  it("uses the middle of the entry range as simulated entry price", () => {
    expect(simulatedEntryPrice({ entryLow: "100", entryHigh: "110" })).toBe(105);
  });

  it("maps a parsed signal row into an executor signal", () => {
    expect(
      signalToExecutorSignal({
        id: "signal-id",
        signalHash: "abc123",
        direction: "SHORT",
        symbol: "BTCUSDT",
        entryLow: "100",
        entryHigh: "110",
        stopLoss: "120",
        takeProfit1: "90",
        leverageRaw: 15,
      })
    ).toEqual({
      signalId: "signal-id",
      signalHash: "abc123",
      direction: "SHORT",
      symbol: "BTCUSDT",
      entryLow: 100,
      entryHigh: 110,
      stopLoss: 120,
      takeProfit1: 90,
      leverageRaw: 15,
    });
  });

  it("provides offline instrument specs for dry-run replay", () => {
    expect(replayInstrumentSpec("BTCUSDT")).toMatchObject({
      symbol: "BTCUSDT",
      qtyStep: 0.001,
      minOrderQty: 0.001,
    });
  });
});
