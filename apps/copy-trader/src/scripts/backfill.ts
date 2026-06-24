import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { logger } from "../logger.js";
import { backfillTelegramHistory, type BackfillMessage } from "../domain/backfill.js";
import { parseBackfillArgs } from "./backfillArgs.js";

let closeDb: (() => Promise<void>) | undefined;

function printHelp(): void {
  console.log(`Usage: pnpm backfill [options]

Options:
  --limit <n>        Maximum messages to scan. Default: 1000
  --batch-size <n>   Telegram page size, max 100. Default: 100
  --before-id <n>    Start scanning messages older than this Telegram message id
  --dry-run          Scan and report counts without inserting rows
  -h, --help         Show this help
`);
}

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const [{ config }, { sql }, { ingestSignalText, isInTargetTopic }] = await Promise.all([
    import("../config.js"),
    import("../db/client.js"),
    import("../listener.js"),
  ]);
  closeDb = () => sql.end({ timeout: 5 });

  const client = new TelegramClient(
    new StringSession(config.TELEGRAM_SESSION_STRING),
    config.TELEGRAM_API_ID,
    config.TELEGRAM_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();
  if (!(await client.checkAuthorization())) {
    throw new Error("Telegram session not authorized - regenerate via `pnpm auth`");
  }

  logger.info("Telegram backfill starting", options);

  const stats = await backfillTelegramHistory({
    client: {
      getMessages: async (channelId, request) =>
        (await client.getMessages(channelId, request)) as BackfillMessage[],
    },
    channelId: config.SIGNAL_CHANNEL_ID,
    limit: options.limit,
    batchSize: options.batchSize,
    beforeId: options.beforeId,
    dryRun: options.dryRun,
    isInTargetTopic,
    ingest: (text, msgId, senderId) =>
      ingestSignalText(text, msgId, senderId, { execute: false, notify: false }),
  });

  logger.info("Telegram backfill complete", stats);
}

main()
  .catch((error) => {
    logger.error("Telegram backfill failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb?.().catch(() => undefined);
  });
