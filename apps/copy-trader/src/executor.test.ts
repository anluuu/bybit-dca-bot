import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the bybit client surface used by executor.
vi.mock("./bybit.js", () => ({
  ExchangeApiError: class extends Error {},
  ExchangeClientError: class extends Error {},
  setLeverage: vi.fn(async () => undefined),
  setMarginModeIsolated: vi.fn(async () => undefined),
  createOrder: vi.fn(async () => ({ orderId: "BYBIT-ORDER-1", orderLinkId: "copy-h1abc" })),
  getLastPrice: vi.fn(async () => 79600),
  getWalletBalanceUsdt: vi.fn(async () => 1000),
}));

vi.mock("./instrumentInfo.js", () => ({
  getInstrumentSpec: vi.fn(async () => ({
    symbol: "BTCUSDT",
    qtyStep: 0.001,
    minOrderQty: 0.001,
    maxOrderQty: 100,
    tickSize: 0.1,
  })),
}));

// Drizzle insert is a chain; mock returns the inserted row id.
const insertedRows: any[] = [];
vi.mock("./db/client.js", () => {
  return {
    db: {
      insert: () => ({
        values: (v: any) => ({
          returning: async () => {
            insertedRows.push(v);
            return [{ id: "trade-1" }];
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    },
  };
});

import { executeSignal, type ExecutorSignal } from "./executor.js";
import { createOrder, setLeverage } from "./bybit.js";

const sig: ExecutorSignal = {
  signalId: "sig-1",
  signalHash: "h1abc",
  direction: "SHORT",
  symbol: "BTCUSDT",
  entryLow: 79400,
  entryHigh: 79900,
  stopLoss: 83000,
  takeProfit1: 76400,
  leverageRaw: 15,
};

beforeEach(() => {
  insertedRows.length = 0;
  vi.clearAllMocks();
});

describe("executeSignal — DRY_RUN", () => {
  it("inserts DRY_RUN_LOGGED row and does NOT call Bybit createOrder", async () => {
    await executeSignal(sig, {
      dryRun: true,
      maxLeverage: 10,
      maxRiskPct: 2,
      balanceUsdt: 1000,
      lastPrice: 79600,
      entryStrategy: "MARKET",
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(insertedRows[0].status).toBe("DRY_RUN_LOGGED");
    expect(insertedRows[0].dryRun).toBe(true);
    expect(insertedRows[0].leverageUsed).toBe(10); // capped from 15
  });
});

describe("executeSignal — live", () => {
  it("calls setLeverage + createOrder + inserts PENDING_FILL", async () => {
    await executeSignal(sig, {
      dryRun: false,
      maxLeverage: 10,
      maxRiskPct: 2,
      balanceUsdt: 1000,
      lastPrice: 79600,
      entryStrategy: "MARKET",
    });
    expect(setLeverage).toHaveBeenCalledWith("BTCUSDT", 10);
    expect(createOrder).toHaveBeenCalledOnce();
    expect(insertedRows[0].status).toBe("PENDING_FILL");
    expect(insertedRows[0].dryRun).toBe(false);
    expect(insertedRows[0].bybitOrderId).toBe("BYBIT-ORDER-1");
  });
});
