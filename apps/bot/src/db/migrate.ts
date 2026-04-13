import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.js";
import { logger } from "../logger.js";

export async function runMigrations() {
  logger.info("Running database migrations...");
  try {
    await migrate(db, { migrationsFolder: "./drizzle/migrations" });
    logger.info("Migrations completed successfully");
  } catch (error) {
    logger.error("Migration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Run directly if executed as a script
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  runMigrations()
    .then(() => {
      logger.info("Migration script complete");
      return sql.end();
    })
    .catch(() => process.exit(1));
}
