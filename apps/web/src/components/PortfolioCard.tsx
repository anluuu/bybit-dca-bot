import { LineChart, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PortfolioPnl } from "../lib/api.ts";
import { formatCurrency, formatCurrencyCompact } from "../lib/format.ts";

interface PortfolioCardProps {
  pnl: PortfolioPnl;
}

function formatSignedCurrency(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatSignedPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function colorClass(value: number | null): string {
  if (value === null || value === 0) return "text-surface-400";
  return value > 0 ? "text-emerald-400" : "text-red-400";
}

export function PortfolioCard({ pnl }: PortfolioCardProps) {
  const { t } = useTranslation();
  const priceUnavailable = pnl.currentPrice === null;
  const ageSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(pnl.priceAsOf).getTime()) / 1000)
  );
  const stalenessLabel = priceUnavailable
    ? t("portfolio.priceUnavailable")
    : t("portfolio.priceStale", {
        when:
          ageSec < 60
            ? `${ageSec}s ago`
            : `${Math.floor(ageSec / 60)}m ago`,
      });

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            {t("portfolio.title")}
          </h2>
        </div>
        {pnl.priceStale && (
          <span className="flex items-center gap-1 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-surface-400">
            <Clock className="h-3 w-3" />
            {stalenessLabel}
          </span>
        )}
      </div>

      {/* Hero: portfolio value */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tabular-nums text-surface-100">
          {pnl.portfolioValue !== null ? formatCurrency(pnl.portfolioValue) : "—"}
        </span>
        <span className="text-xs text-surface-400">{t("portfolio.value")}</span>
      </div>

      {/* Secondary: PnL with color + sign */}
      <div className="mb-4 flex items-baseline gap-2">
        <span
          className={`font-mono text-sm font-medium tabular-nums ${colorClass(
            pnl.unrealizedPnl
          )}`}
        >
          {formatSignedCurrency(pnl.unrealizedPnl)}
        </span>
        <span className="text-xs text-surface-400">{t("portfolio.pnl")}</span>
      </div>

      {/* Stats row: ROI | avg cost | avg vs spot */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-surface-700/30">
        <MiniStat
          label={t("portfolio.roi")}
          value={formatSignedPct(pnl.roiPct)}
          colorValue={pnl.roiPct}
        />
        <MiniStat
          label={t("portfolio.avgCost")}
          value={
            pnl.avgPrice > 0 ? formatCurrencyCompact(pnl.avgPrice) : "—"
          }
        />
        <MiniStat
          label={t("portfolio.avgVsSpot")}
          value={formatSignedPct(pnl.avgVsSpotPct)}
          colorValue={pnl.avgVsSpotPct}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  colorValue,
}: {
  label: string;
  value: string;
  colorValue?: number | null;
}) {
  const color =
    colorValue !== undefined ? colorClass(colorValue) : "text-surface-100";
  return (
    <div>
      <p className="text-xs text-surface-400">{label}</p>
      <p
        className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${color}`}
      >
        {value}
      </p>
    </div>
  );
}
