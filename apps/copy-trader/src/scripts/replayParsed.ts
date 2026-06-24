import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, sql } from "../db/client.js";
import { signals } from "../db/schema.js";
import { executeSignal } from "../domain/executor.js";
import { signalToExecutorSignal, simulatedEntryPrice } from "../domain/replayParsed.js";
import { getAllConfig } from "../infra/configStore.js";
import { logger } from "../logger.js";
import { parseReplayParsedArgs } from "./replayParsedArgs.js";

function printHelp(): void {
  console.log(`Usage: pnpm replay-parsed [options]

Options:
  --limit <n>          Maximum parsed signals to replay. Default: 10
  --balance-usdt <n>   Simulated balance for dry-run sizing. Default: 1000
  --oldest-first       Replay oldest parsed signal first. Default: newest first
  -h, --help           Show this help
`);
}

async function main(): Promise<void> {
  const options = parseReplayParsedArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cfg = await getAllConfig();
  const rows = await db
    .select()
    .from(signals)
    .where(and(eq(signals.status, "PARSED"), isNull(signals.tradeId)))
    .orderBy(options.oldestFirst ? asc(signals.receivedAt) : desc(signals.receivedAt))
    .limit(options.limit);

  logger.info("Parsed replay starting", {
    count: rows.length,
    limit: options.limit,
    balanceUsdt: options.balanceUsdt,
    oldestFirst: options.oldestFirst,
  });

  let replayed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const signal = signalToExecutorSignal(row);
      await executeSignal(signal, {
        dryRun: true,
        maxLeverage: Number(cfg.MAX_LEVERAGE),
        maxRiskPct: Number(cfg.MAX_RISK_PCT),
        balanceUsdt: options.balanceUsdt,
        lastPrice: simulatedEntryPrice(row),
        entryStrategy: "MARKET",
      });
      replayed += 1;
    } catch (error) {
      failed += 1;
      logger.error("Parsed replay failed", {
        signalId: row.id,
        signalHash: row.signalHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("Parsed replay complete", { replayed, failed });
}

main()
  .catch((error) => {
    logger.error("Parsed replay crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });
