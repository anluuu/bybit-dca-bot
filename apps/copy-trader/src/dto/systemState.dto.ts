import type { CopySystemState } from "@dca/shared";
import type { SystemState } from "../db/schema.js";

export function mapSystemStateRowToWire(r: SystemState | undefined): CopySystemState {
  return {
    killed: r?.killed ?? false,
    killedReason: r?.killedReason ?? null,
    killedAt: r?.killedAt?.toISOString() ?? null,
    cooldownUntil: r?.cooldownUntil?.toISOString() ?? null,
    cooldownReason: r?.cooldownReason ?? null,
    initialCapital: r?.initialCapital ?? null,
  };
}
