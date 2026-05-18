import type { CopyStats } from "@dca/shared";
import { getStats } from "../services/stats.service.js";

export async function getStatsHandler(): Promise<CopyStats> {
  return await getStats();
}
