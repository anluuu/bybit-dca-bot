import type { PublicSignals } from "@dca/shared";
import { getCompositeSignal } from "../signals/compose.js";
import { getMonthlySpent } from "../spending.js";
import type { Asset } from "../db/schema.js";

export async function getPublicSignals(asset: Asset): Promise<PublicSignals> {
  const signal = await getCompositeSignal(asset.pair);
  const spent = await getMonthlySpent(asset.pair);
  const cap = parseFloat(asset.monthlyCap);
  const capUtilizationPct = cap > 0 ? (spent / cap) * 100 : null;

  return {
    mayerMultiple: signal.mayer ? signal.mayer.multiple : null,
    ma200wDistancePct: signal.ma200w ? signal.ma200w.distancePct : null,
    fearGreedIndex: signal.fearGreed ? signal.fearGreed.value : null,
    fearGreedClassification: signal.fearGreed
      ? signal.fearGreed.classification
      : null,
    compositeScore:
      signal.fallback === "all_down" ? null : signal.composite,
    capUtilizationPct,
    fallback: signal.fallback,
    generatedAt: signal.generatedAt,
  };
}
