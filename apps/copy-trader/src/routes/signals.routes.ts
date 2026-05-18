import type { FastifyInstance } from "fastify";
import type { CopySignalsPage } from "@dca/shared";
import { authPreHandler } from "./auth.middleware.js";
import { listSignals } from "../services/signals.service.js";

export function registerSignalsRoutes(app: FastifyInstance): void {
  app.get(
    "/api/copy/signals",
    { preHandler: authPreHandler },
    async (req): Promise<CopySignalsPage> => {
      const q = req.query as { page?: string; pageSize?: string; status?: string };
      return await listSignals({
        page: Number(q.page ?? "1"),
        pageSize: Number(q.pageSize ?? "50"),
        status: q.status,
      });
    }
  );
}
