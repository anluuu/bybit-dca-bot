import type { FastifyInstance } from "fastify";
import { getMonthly } from "../controllers/publicMonthly.controller.js";

export function registerPublicMonthlyRoutes(app: FastifyInstance): void {
  app.get("/api/public/monthly", getMonthly);
}
