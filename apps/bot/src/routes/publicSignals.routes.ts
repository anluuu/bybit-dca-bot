import type { FastifyInstance } from "fastify";
import { getSignals } from "../controllers/publicSignals.controller.js";

export function registerPublicSignalsRoutes(app: FastifyInstance): void {
  app.get(
    "/api/public/signals",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    getSignals
  );
}
