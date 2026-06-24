import { describe, expect, it, vi } from "vitest";
import { backfillTelegramHistory } from "./backfill.js";

describe("backfillTelegramHistory", () => {
  it("paginates Telegram history and ingests eligible messages record-only", async () => {
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 20, message: "LONG BTC\nEntrada: 100 - 101", replyTo: { replyToTopId: 7 }, senderId: 11 },
        { id: 19, message: "", replyTo: { replyToTopId: 7 }, senderId: 11 },
      ])
      .mockResolvedValueOnce([
        { id: 18, message: "SHORT ETH\nEntrada: 90 - 91", replyTo: { replyToTopId: 8 }, senderId: 12 },
        { id: 17, message: "LONG SOL\nEntrada: 10 - 11", replyTo: { replyToTopId: 7 }, senderId: 13 },
      ]);
    const ingest = vi.fn().mockResolvedValue(undefined);

    const stats = await backfillTelegramHistory({
      client: { getMessages },
      channelId: -1001,
      limit: 4,
      batchSize: 2,
      beforeId: 21,
      dryRun: false,
      isInTargetTopic: (msg) => msg.replyTo?.replyToTopId === 7,
      ingest,
    });

    expect(getMessages).toHaveBeenNthCalledWith(1, -1001, { limit: 2, offsetId: 21 });
    expect(getMessages).toHaveBeenNthCalledWith(2, -1001, { limit: 2, offsetId: 19 });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(ingest).toHaveBeenNthCalledWith(1, "LONG BTC\nEntrada: 100 - 101", 20, 11);
    expect(ingest).toHaveBeenNthCalledWith(2, "LONG SOL\nEntrada: 10 - 11", 17, 13);
    expect(stats).toEqual({
      fetched: 4,
      eligible: 2,
      ingested: 2,
      skippedNonText: 1,
      skippedTopic: 1,
      batches: 2,
      oldestId: 17,
    });
  });

  it("does not ingest messages in dry-run mode", async () => {
    const ingest = vi.fn();

    const stats = await backfillTelegramHistory({
      client: {
        getMessages: vi.fn().mockResolvedValueOnce([
          { id: 5, message: "LONG BTC", replyTo: undefined, senderId: undefined },
        ]),
      },
      channelId: -1001,
      limit: 1,
      batchSize: 1,
      dryRun: true,
      isInTargetTopic: () => true,
      ingest,
    });

    expect(ingest).not.toHaveBeenCalled();
    expect(stats.eligible).toBe(1);
    expect(stats.ingested).toBe(0);
  });
});
