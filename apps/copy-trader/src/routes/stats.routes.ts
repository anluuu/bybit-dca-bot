import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { getStatsHandler } from "../controllers/stats.controller.js";

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get("/api/copy/stats", { preHandler: authPreHandler }, getStatsHandler);
}
