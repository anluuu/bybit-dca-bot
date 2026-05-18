import type { FastifyInstance } from "fastify";
import { getSummary } from "../controllers/publicSummary.controller.js";

export function registerPublicSummaryRoutes(app: FastifyInstance): void {
  app.get("/api/public/summary", getSummary);
}
