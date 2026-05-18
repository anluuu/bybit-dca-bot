import type { CopySignal, CopySignalStatus } from "@dca/shared";
import type { Signal } from "../db/schema.js";

export function mapSignalRowToWire(r: Signal): CopySignal {
  return {
    id: r.id,
    signalHash: r.signalHash,
    rawText: r.rawText,
    telegramMsgId: Number(r.telegramMsgId),
    telegramSenderId: r.telegramSenderId == null ? null : Number(r.telegramSenderId),
    receivedAt: r.receivedAt.toISOString(),
    direction: r.direction as "LONG" | "SHORT" | null,
    symbol: r.symbol,
    entryLow: r.entryLow,
    entryHigh: r.entryHigh,
    stopLoss: r.stopLoss,
    leverageRaw: r.leverageRaw,
    takeProfit1: r.takeProfit1,
    takeProfit2: r.takeProfit2,
    takeProfit3: r.takeProfit3,
    status: r.status as CopySignalStatus,
    skipReason: r.skipReason,
  };
}
