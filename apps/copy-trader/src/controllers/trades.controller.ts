import type { FastifyRequest } from "fastify";
import type { CopyTradesPage } from "@dca/shared";
import { listTrades } from "../services/trades.service.js";

export async function getTrades(req: FastifyRequest): Promise<CopyTradesPage> {
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
