import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import {
  listOrders,
  getSummary,
  getMonthly,
} from "../controllers/orders.controller.js";

export function registerOrdersRoutes(app: FastifyInstance): void {
  app.get("/api/orders", { preHandler: authPreHandler }, listOrders);
  app.get("/api/orders/summary", { preHandler: authPreHandler }, getSummary);
  app.get("/api/orders/monthly", { preHandler: authPreHandler }, getMonthly);
}
