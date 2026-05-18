import type { FastifyInstance } from "fastify";
import { getLive, getReady } from "../controllers/health.controller.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health/live", getLive);
  app.get("/health/ready", getReady);
}
