import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { getConfig, putConfig } from "../controllers/config.controller.js";

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get("/api/copy/config", { preHandler: authPreHandler }, getConfig);
  app.put<{ Params: { key: string }; Body: { value: string } }>(
    "/api/copy/config/:key",
    { preHandler: authPreHandler },
    putConfig
  );
}
