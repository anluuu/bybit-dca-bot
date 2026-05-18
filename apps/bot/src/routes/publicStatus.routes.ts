import type { FastifyInstance } from "fastify";
import { getStatus } from "../controllers/publicStatus.controller.js";

export function registerPublicStatusRoutes(app: FastifyInstance): void {
  app.get("/api/public/status", getStatus);
}
