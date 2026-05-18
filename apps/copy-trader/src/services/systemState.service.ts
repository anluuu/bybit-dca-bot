import { eq } from "drizzle-orm";
import type { CopySystemState } from "@dca/shared";
import { db } from "../db/client.js";
import { systemState } from "../db/schema.js";
import { mapSystemStateRowToWire } from "../dto/systemState.dto.js";

export async function getSystemState(): Promise<CopySystemState> {
  const rows = await db.select().from(systemState).where(eq(systemState.id, 1)).limit(1);
  return mapSystemStateRowToWire(rows[0]);
}

export async function resetKillSwitch(): Promise<void> {
  await db
    .update(systemState)
    .set({ killed: false, killedReason: null, killedAt: null, updatedAt: new Date() })
    .where(eq(systemState.id, 1));
}

export async function kill(reason: string): Promise<void> {
  await db
    .update(systemState)
    .set({ killed: true, killedReason: reason, killedAt: new Date(), updatedAt: new Date() })
    .where(eq(systemState.id, 1));
}
