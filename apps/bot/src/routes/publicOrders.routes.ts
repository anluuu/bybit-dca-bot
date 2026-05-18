import type { FastifyInstance } from "fastify";
import { listOrders } from "../controllers/publicOrders.controller.js";

export function registerPublicOrdersRoutes(app: FastifyInstance): void {
  app.get(
    "/api/public/orders",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    listOrders
  );
}
