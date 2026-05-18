import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  schemaFilter: ["copy_trader"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
