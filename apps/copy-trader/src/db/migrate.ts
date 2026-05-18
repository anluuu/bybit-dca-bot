import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.js";
import { logger } from "../logger.js";

export async function runMigrations(): Promise<void> {
  logger.info("Running copy_trader migrations");
  // Create schema before migrations apply CREATE TABLE statements
  await sql`CREATE SCHEMA IF NOT EXISTS copy_trader`;
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  logger.info("Migrations complete");
}

// Standalone CLI usage: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => sql.end())
    .catch((err) => {
      logger.error("Migration failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
