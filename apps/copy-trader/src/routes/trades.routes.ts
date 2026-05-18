import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { getTrades } from "../controllers/trades.controller.js";

export function registerTradesRoutes(app: FastifyInstance): void {
  app.get("/api/copy/trades", { preHandler: authPreHandler }, getTrades);
}
