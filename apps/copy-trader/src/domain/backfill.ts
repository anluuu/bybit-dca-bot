export type BackfillMessage = {
  id: number;
  message?: string;
  replyTo?: { replyToTopId?: number; replyToMsgId?: number } | undefined;
  senderId?: unknown;
};

export type HistoryClient = {
  getMessages(
    channelId: number,
    options: { limit: number; offsetId?: number }
  ): Promise<BackfillMessage[]>;
};

export type BackfillStats = {
  fetched: number;
  eligible: number;
  ingested: number;
  skippedNonText: number;
  skippedTopic: number;
  batches: number;
  oldestId: number | null;
};

export type BackfillOptions = {
  client: HistoryClient;
  channelId: number;
  limit: number;
  batchSize: number;
  beforeId?: number;
  dryRun: boolean;
  isInTargetTopic: (msg: BackfillMessage) => boolean;
  ingest: (text: string, msgId: number, senderId: number | null) => Promise<void>;
};

function extractSenderId(senderId: unknown): number | null {
  if (senderId == null) return null;
  const value =
    typeof senderId === "object" && "value" in senderId
      ? Number((senderId as { value: unknown }).value)
      : Number(senderId);
  return Number.isFinite(value) ? value : null;
}

export async function backfillTelegramHistory(opts: BackfillOptions): Promise<BackfillStats> {
  let remaining = opts.limit;
  let offsetId = opts.beforeId;
  const stats: BackfillStats = {
    fetched: 0,
    eligible: 0,
    ingested: 0,
    skippedNonText: 0,
    skippedTopic: 0,
    batches: 0,
    oldestId: null,
  };

  while (remaining > 0) {
    const batchLimit = Math.min(opts.batchSize, remaining);
    const request = offsetId == null ? { limit: batchLimit } : { limit: batchLimit, offsetId };
    const messages = await opts.client.getMessages(opts.channelId, request);
    if (messages.length === 0) break;

    stats.batches += 1;
    stats.fetched += messages.length;
    remaining -= messages.length;

    for (const msg of messages) {
      stats.oldestId = stats.oldestId == null ? msg.id : Math.min(stats.oldestId, msg.id);

      if (!msg.message || typeof msg.message !== "string") {
        stats.skippedNonText += 1;
        continue;
      }
      if (!opts.isInTargetTopic(msg)) {
        stats.skippedTopic += 1;
        continue;
      }

      stats.eligible += 1;
      if (!opts.dryRun) {
        await opts.ingest(msg.message, msg.id, extractSenderId(msg.senderId));
        stats.ingested += 1;
      }
    }

    const oldestInBatch = Math.min(...messages.map((msg) => msg.id));
    if (offsetId === oldestInBatch || messages.length < batchLimit) break;
    offsetId = oldestInBatch;
  }

  return stats;
}
