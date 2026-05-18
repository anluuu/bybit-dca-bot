import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { registerAuthRoutes } from "./auth.routes.js";
import { registerHealthRoutes } from "./health.routes.js";
import { registerPublicSummaryRoutes } from "./publicSummary.routes.js";
import { registerPublicMonthlyRoutes } from "./publicMonthly.routes.js";
import { registerPublicStatusRoutes } from "./publicStatus.routes.js";
import { registerPublicOrdersRoutes } from "./publicOrders.routes.js";
import { registerPublicPnlRoutes } from "./publicPnl.routes.js";
import { registerPublicSignalsRoutes } from "./publicSignals.routes.js";
import { registerPublicChartRoutes } from "./publicChart.routes.js";
import { registerOrdersRoutes } from "./orders.routes.js";
import { registerAssetsRoutes } from "./assets.routes.js";
import { registerTestOrderRoutes } from "./testOrder.routes.js";
import { registerAdminRoutes } from "./admin.routes.js";

export function registerRoutes(app: FastifyInstance, redis: Redis): void {
  registerAuthRoutes(app);
  registerHealthRoutes(app, redis);
  registerPublicSummaryRoutes(app);
  registerPublicMonthlyRoutes(app);
  registerPublicStatusRoutes(app);
  registerPublicOrdersRoutes(app);
  registerPublicPnlRoutes(app);
  registerPublicSignalsRoutes(app);
  registerPublicChartRoutes(app);
  registerOrdersRoutes(app);
  registerAssetsRoutes(app);
  registerTestOrderRoutes(app);
  registerAdminRoutes(app);
}
