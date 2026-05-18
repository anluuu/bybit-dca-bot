import type { FastifyInstance } from "fastify";
import type { CopyConfig } from "@dca/shared";
import { authPreHandler } from "./auth.middleware.js";
import { getAllConfig, setConfig } from "../configStore.js";

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get(
    "/api/copy/config",
    { preHandler: authPreHandler },
    async (): Promise<CopyConfig> => await getAllConfig()
  );

  app.put<{ Params: { key: string }; Body: { value: string } }>(
    "/api/copy/config/:key",
    { preHandler: authPreHandler },
    async (req, reply) => {
      const { key } = req.params;
      const value = req.body?.value;
      if (typeof value !== "string") {
        reply.code(400);
        return { error: "value must be a string" };
      }
      try {
        await setConfig(key, value);
        return { ok: true };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
  );
}
