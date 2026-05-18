import type { FastifyInstance } from "fastify";
import type { CopyTradesPage } from "@dca/shared";
import { authPreHandler } from "./auth.middleware.js";
import { listTrades } from "../services/trades.service.js";

export function registerTradesRoutes(app: FastifyInstance): void {
  app.get(
    "/api/copy/trades",
    { preHandler: authPreHandler },
    async (req): Promise<CopyTradesPage> => {
      const q = req.query as {
        page?: string;
        pageSize?: string;
        status?: string;
        includeDryRun?: string;
      };
      return await listTrades({
        page: Number(q.page ?? "1"),
        pageSize: Number(q.pageSize ?? "50"),
        status: q.status,
        includeDryRun: q.includeDryRun === "true",
      });
    }
  );
}
