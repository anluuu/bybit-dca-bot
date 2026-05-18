import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { getSignals } from "../controllers/signals.controller.js";

export function registerSignalsRoutes(app: FastifyInstance): void {
  app.get("/api/copy/signals", { preHandler: authPreHandler }, getSignals);
}
