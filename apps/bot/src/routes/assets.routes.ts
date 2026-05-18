import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import { listAssetsHandler } from "../controllers/assets.controller.js";

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get("/api/assets", { preHandler: authPreHandler }, listAssetsHandler);
}
