import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { runNow, pingTelegram } from "../controllers/admin.controller.js";

export function registerAdminRoutes(app: FastifyInstance): void {
  app.post(
    "/api/admin/run-now",
    {
      preHandler: authPreHandler,
      config: { rateLimit: { max: 1, timeWindow: "1 minute" } },
    },
    runNow
  );
  app.post(
    "/api/admin/telegram/ping",
    {
      preHandler: authPreHandler,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    pingTelegram
  );
}
