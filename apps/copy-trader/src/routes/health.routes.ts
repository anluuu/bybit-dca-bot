import type { FastifyInstance } from "fastify";
import { sql as pg } from "../db/client.js";
import { logger } from "../logger.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health/live", async () => ({ ok: true }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await pg`SELECT 1`;
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.error("Readiness probe failed", { error });
      reply.code(503);
      return { ok: false, error };
    }
  });
}
