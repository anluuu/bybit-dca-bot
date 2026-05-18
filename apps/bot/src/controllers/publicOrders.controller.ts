import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import { listPublicOrders } from "../services/orders.service.js";

const ordersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listOrders(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = ordersQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({ error: "Invalid query params" });
    return;
  }
  const { page, pageSize } = parsed.data;
  const result = await listPublicOrders({ page, pageSize });
  reply.send(result);
}
