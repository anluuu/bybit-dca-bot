import { config } from "./config.js";
import { logger } from "./logger.js";
import { runMigrations } from "./db/migrate.js";
import { initNotifier, verifyChat, notifyLifecycle } from "./infra/notifications.js";
import { startListener, stopListener } from "./listener.js";
import { reconcileRecentMessages } from "./recovery.js";
import { startServer } from "./server.js";
import { db } from "./db/client.js";
import { systemState } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { seedDefaults } from "./infra/configStore.js";
import { registerWatcherRepeatable, startWatcherWorker, closeQueue } from "./infra/queue.js";
import { watcherTick } from "./domain/watcher.js";
import { getWalletBalanceUsdt } from "./infra/bybit.js";

async function ensureSystemStateRow(): Promise<void> {
  const existing = await db.select().from(systemState).where(eq(systemState.id, 1)).limit(1);
  if (existing.length === 0) {
    await db.insert(systemState).values({ id: 1 });
    logger.info("system_state row created");
  }
}

async function bootstrapInitialCapital(): Promise<void> {
  const rows = await db.select().from(systemState).where(eq(systemState.id, 1));
  if (rows[0]?.initialCapital) return;
  let capital = config.INITIAL_CAPITAL_USDT_OVERRIDE;
  if (capital === 0 && config.BYBIT_API_KEY) {
    try {
      capital = await getWalletBalanceUsdt();
    } catch (e) {
      logger.warn("Could not read Bybit balance for initial capital", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (capital > 0) {
    await db
      .update(systemState)
      .set({ initialCapital: String(capital), updatedAt: new Date() })
      .where(eq(systemState.id, 1));
    logger.info("system_state.initial_capital populated", { capital });
  }
}

async function main() {
  logger.info("Boot starting", { nodeEnv: config.NODE_ENV });

  await runMigrations();
  await ensureSystemStateRow();
  await seedDefaults();
  await bootstrapInitialCapital();

  initNotifier();
  await verifyChat();

  const client = await startListener();
  await reconcileRecentMessages(client);

  await registerWatcherRepeatable(30_000);
  const watcherWorker = startWatcherWorker(async () => {
    await watcherTick();
  });

  const app = await startServer();
  await notifyLifecycle("started");

  const shutdown = async (signal: string) => {
    logger.info("Shutdown signal", { signal });
    try {
      await app.close();
      await stopListener();
      await watcherWorker.close();
      await closeQueue();
      await notifyLifecycle("stopped", `signal=${signal}`);
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (error) => {
  logger.error("Fatal boot error", {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    await notifyLifecycle("crashed", error instanceof Error ? error.message : String(error));
  } catch {
    // best effort
  }
  process.exit(1);
});
