import type { FastifyRequest } from "fastify";
import type { CopySystemState } from "@dca/shared";
import {
  getSystemState,
  resetKillSwitch,
  kill,
} from "../services/systemState.service.js";

export async function getSystemStateHandler(): Promise<CopySystemState> {
  return await getSystemState();
}

export async function resetKillSwitchHandler(): Promise<{ ok: true }> {
  await resetKillSwitch();
  return { ok: true };
}

export async function killHandler(
  req: FastifyRequest<{ Body: { reason?: string } }>
): Promise<{ ok: true }> {
  const reason = req.body?.reason ?? "manual";
  await kill(reason);
  return { ok: true };
}
