import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OrdersSummary } from "../lib/api.ts";
import {
  formatBtc,
  formatCurrency,
  formatCurrencyCompact,
} from "../lib/format.ts";

interface SpendingCardProps {
  summary: OrdersSummary;
}

export function SpendingCard({ summary }: SpendingCardProps) {
  const { t } = useTranslation();
  const pct = Math.min(
    (summary.monthlySpent / summary.monthlyCap) * 100,
    100
  );
  const remaining = Math.max(summary.monthlyCap - summary.monthlySpent, 0);
  const isNearCap = pct >= 80;

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("spending.monthlySpending")}
        </h2>
      </div>

      {/* Amount display */}
      <div className="mb-1 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-bold tabular-nums text-surface-100">
          {formatCurrency(summary.monthlySpent)}
        </span>
        <span className="font-mono text-sm text-surface-400">
          / {formatCurrency(summary.monthlyCap)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-800">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${pct}%`,
              background: isNearCap
                ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                : "linear-gradient(90deg, #f59e0b, #fbbf24)",
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-xs text-surface-400">
          <span>{t("spending.used", { pct: pct.toFixed(0) })}</span>
          <span>
            {t("spending.remaining", {
              amount: formatCurrencyCompact(remaining),
            })}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-surface-700/30">
        <MiniStat
          label={t("spending.totalSpent")}
          value={formatCurrencyCompact(summary.totalSpent)}
        />
        <MiniStat
          label={t("spending.totalBtc")}
          value={formatBtc(summary.totalBtc, 6)}
          accent
        />
        <MiniStat
          label={t("spending.avgPrice")}
          value={formatCurrencyCompact(summary.avgPrice)}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-surface-400">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${accent ? "text-amber-glow" : "text-surface-100"}`}
      >
        {value}
      </p>
    </div>
  );
}
