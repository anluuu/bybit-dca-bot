import type { FastifyInstance } from "fastify";
import type { CopyStats } from "@dca/shared";
import { authPreHandler } from "./auth.middleware.js";
import { getStats } from "../services/stats.service.js";

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get(
    "/api/copy/stats",
    { preHandler: authPreHandler },
    async (): Promise<CopyStats> => await getStats()
  );
}
