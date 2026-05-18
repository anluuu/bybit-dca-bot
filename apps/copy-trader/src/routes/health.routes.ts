import type { FastifyInstance } from "fastify";
import { isDbReady } from "../services/health.service.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health/live", async () => ({ ok: true }));

  app.get("/health/ready", async (_req, reply) => {
    const ok = await isDbReady();
    if (!ok) reply.code(503);
    return { ok };
  });
}
