import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { getStatus, createReadyHandler } from "../controllers/health.controller.js";

export function registerHealthRoutes(app: FastifyInstance, redis: Redis): void {
  app.get("/health", getStatus);
  app.get("/health/ready", createReadyHandler(redis));
}
