import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.routes.js";
import { registerSignalsRoutes } from "./signals.routes.js";
import { registerTradesRoutes } from "./trades.routes.js";
import { registerStatsRoutes } from "./stats.routes.js";
import { registerSystemStateRoutes } from "./systemState.routes.js";
import { registerConfigRoutes } from "./config.routes.js";

export function registerRoutes(app: FastifyInstance): void {
  registerHealthRoutes(app);
  registerSignalsRoutes(app);
  registerTradesRoutes(app);
  registerStatsRoutes(app);
  registerSystemStateRoutes(app);
  registerConfigRoutes(app);
}
