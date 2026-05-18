import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { preview, execute } from "../controllers/testOrder.controller.js";

export function registerTestOrderRoutes(app: FastifyInstance): void {
  app.post(
    "/api/test/preview",
    {
      preHandler: authPreHandler,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    preview
  );
  app.post(
    "/api/test/execute",
    {
      preHandler: authPreHandler,
      config: { rateLimit: { max: 2, timeWindow: "1 minute" } },
    },
    execute
  );
}
