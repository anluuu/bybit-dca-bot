import type { FastifyInstance } from "fastify";
import { getChart } from "../controllers/publicChart.controller.js";

export function registerPublicChartRoutes(app: FastifyInstance): void {
  app.get("/api/public/chart", getChart);
}
