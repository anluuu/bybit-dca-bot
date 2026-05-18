import type { FastifyInstance } from "fastify";
import { authPreHandler } from "./auth.middleware.js";
import {
  getSystemStateHandler,
  resetKillSwitchHandler,
  killHandler,
} from "../controllers/systemState.controller.js";

export function registerSystemStateRoutes(app: FastifyInstance): void {
  app.get("/api/copy/system-state", { preHandler: authPreHandler }, getSystemStateHandler);
  app.post("/api/copy/admin/reset-kill-switch", { preHandler: authPreHandler }, resetKillSwitchHandler);
  app.post<{ Body: { reason?: string } }>(
    "/api/copy/admin/kill",
    { preHandler: authPreHandler },
    killHandler
  );
}
