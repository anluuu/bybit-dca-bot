import { config } from "./config.js";
import { logger } from "./logger.js";
import { runMigrations } from "./db/migrate.js";
import { initNotifier, verifyChat, notifyLifecycle } from "./notifications.js";
import { startListener, stopListener } from "./listener.js";
import { reconcileRecentMessages } from "./recovery.js";
import { startServer } from "./server.js";

async function main() {
  logger.info("Boot starting", { nodeEnv: config.NODE_ENV });

  await runMigrations();

  initNotifier();
  await verifyChat();

  const client = await startListener();
  await reconcileRecentMessages(client);

  const app = await startServer();
  await notifyLifecycle("started");

  const shutdown = async (signal: string) => {
    logger.info("Shutdown signal", { signal });
    try {
      await app.close();
      await stopListener();
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
