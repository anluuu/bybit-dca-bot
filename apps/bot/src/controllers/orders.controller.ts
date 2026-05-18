import { z } from "zod/v4";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  listAdminOrders,
  getOrdersSummary,
  getMonthlyBreakdown,
  ALLOWED_STATUSES,
  type AllowedStatus,
} from "../services/orders.service.js";

const ordersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Admin-only extra filters. Public listing intentionally stays unfiltered
// so search engines / casual viewers see the same raw history every time.
const adminOrdersQuerySchema = ordersQuerySchema.extend({
  status: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter((s): s is AllowedStatus =>
              (ALLOWED_STATUSES as readonly string[]).includes(s)
            )
        : undefined
    ),
  includeTest: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export async function listOrders(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const parsed = adminOrdersQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({ error: "Invalid query params" });
    return;
  }
  const { page, pageSize, status, includeTest } = parsed.data;
  const result = await listAdminOrders({ page, pageSize, status, includeTest });
  reply.send(result);
}

export async function getSummary(): Promise<ReturnType<typeof getOrdersSummary>> {
  return getOrdersSummary();
}

export async function getMonthly(): Promise<ReturnType<typeof getMonthlyBreakdown>> {
  return getMonthlyBreakdown();
}
