import type { FastifyRequest } from "fastify";
import type { CopySignalsPage } from "@dca/shared";
import { listSignals } from "../services/signals.service.js";

export async function getSignals(req: FastifyRequest): Promise<CopySignalsPage> {
  const q = req.query as { page?: string; pageSize?: string; status?: string };
  return await listSignals({
    page: Number(q.page ?? "1"),
    pageSize: Number(q.pageSize ?? "50"),
    status: q.status,
  });
}
