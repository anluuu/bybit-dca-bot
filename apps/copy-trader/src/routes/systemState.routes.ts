import type { FastifyInstance } from "fastify";
import type { CopySystemState } from "@dca/shared";
import { authPreHandler } from "./auth.middleware.js";
import {
  getSystemState,
  resetKillSwitch,
  kill,
} from "../services/systemState.service.js";

export function registerSystemStateRoutes(app: FastifyInstance): void {
  app.get(
    "/api/copy/system-state",
    { preHandler: authPreHandler },
    async (): Promise<CopySystemState> => await getSystemState()
  );

  app.post(
    "/api/copy/admin/reset-kill-switch",
    { preHandler: authPreHandler },
    async () => {
      await resetKillSwitch();
      return { ok: true };
    }
  );

  app.post<{ Body: { reason?: string } }>(
    "/api/copy/admin/kill",
    { preHandler: authPreHandler },
    async (req) => {
      const reason = req.body?.reason ?? "manual";
      await kill(reason);
      return { ok: true };
    }
  );
}
