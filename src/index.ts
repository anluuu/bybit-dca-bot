import { config } from "./config.js";
import { db } from "./db/client.js";
import { sql } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { assets } from "./db/schema.js";
import { createRedisConnection, setupQueue, registerJobs } from "./queue.js";
import { startServer } from "./server.js";
import { initBot } from "./notifications.js";
import { logger } from "./logger.js";

async function seedAssets() {
  const existing = await db.select().from(assets);
  if (existing.length > 0) return;

  logger.info("Seeding assets table from environment variables");

  await db.insert(assets).values({
    pair: config.TRADING_PAIR,
    buyAmount: config.BUY_AMOUNT_BRL.toFixed(2),
    monthlyCap: config.MONTHLY_CAP_BRL.toFixed(2),
    cronSchedule: config.CRON_SCHEDULE,
    limitDiscount: config.LIMIT_DISCOUNT_PCT.toFixed(3),
    limitWaitMins: config.LIMIT_WAIT_MINUTES,
  });

  logger.info("Seeded asset", {
    pair: config.TRADING_PAIR,
    buyAmount: config.BUY_AMOUNT_BRL,
    schedule: config.CRON_SCHEDULE,
  });
}

async function main() {
  logger.info("Starting Bybit DCA Bot...");

  // 1. Run database migrations
  await runMigrations();

  // 2. Seed assets if empty
  await seedAssets();

  // 3. Initialize Telegram bot
  initBot();

  // 4. Initialize Redis + BullMQ
  const redisConnection = createRedisConnection();
  const { queue, worker } = await setupQueue(redisConnection);

  // 5. Register repeatable jobs
  await registerJobs(queue);

  // 6. Start Fastify server
  const server = await startServer(redisConnection);

  logger.info("Bot is running", {
    pair: config.TRADING_PAIR,
    buyAmount: config.BUY_AMOUNT_BRL,
    schedule: config.CRON_SCHEDULE,
    port: config.PORT,
  });

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);

    // Stop accepting new jobs
    await worker.close();
    await queue.close();

    // Close HTTP server
    await server.close();

    // Close Redis
    redisConnection.disconnect();

    // Close DB
    await sql.end();

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("Fatal error during startup", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
