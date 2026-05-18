import type { FastifyInstance } from "fastify";
import { getPnlHandler } from "../controllers/publicPnl.controller.js";

export function registerPublicPnlRoutes(app: FastifyInstance): void {
  app.get(
    "/api/public/pnl",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    getPnlHandler
  );
}
