import { Activity, AlertTriangle, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PublicSignals } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";

/**
 * Live snapshot of the market signals that contextualize every DCA buy.
 *
 * Renders three tiles (Mayer Multiple, 200W MA distance, Fear & Greed) and
 * a composite bar scaled -1..+1 (expensive ↔ cheap). Same shape for admin
 * and public — no strategy-internal info is exposed anywhere, since the
 * bot does not modulate its buy size based on these signals.
 */

interface Props {
  data: PublicSignals | undefined;
}

function formatSignalNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Map a raw composite score in [-1, 1] to a visual bar fill. We center at
 * 50% and push left/right proportionally so the zero anchor lines up with
 * the midpoint of the track.
 */
function scoreBarFill(score: number | null): {
  left: number;
  width: number;
  color: string;
} {
  if (score === null) return { left: 50, width: 0, color: "transparent" };
  const clamped = Math.max(-1, Math.min(1, score));
  const pct = Math.abs(clamped) * 50;
  if (clamped >= 0) {
    return { left: 50, width: pct, color: "var(--color-green-gain)" };
  }
  return { left: 50 - pct, width: pct, color: "var(--color-red-loss)" };
}

function SignalTile({
  label,
  hint,
  value,
  accent,
}: {
  label: string;
  hint: string;
  value: string;
  accent?: "cheap" | "expensive" | "neutral";
}) {
  const accentClass =
    accent === "cheap"
      ? "text-green-gain"
      : accent === "expensive"
        ? "text-red-loss"
        : "text-surface-100";
  return (
    <div className="rounded-lg border border-surface-700/30 bg-surface-800/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-surface-400">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-medium tabular-nums ${accentClass}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-surface-500">{hint}</p>
    </div>
  );
}

/** Color a value by whether it points to cheap/expensive accumulation. */
function accentMayer(multiple: number | null): "cheap" | "expensive" | "neutral" {
  if (multiple === null) return "neutral";
  if (multiple <= 0.9) return "cheap";
  if (multiple >= 2.4) return "expensive";
  return "neutral";
}
function accentMa200w(distPct: number | null): "cheap" | "expensive" | "neutral" {
  if (distPct === null) return "neutral";
  if (distPct <= -10) return "cheap";
  if (distPct >= 150) return "expensive";
  return "neutral";
}
function accentFearGreed(value: number | null): "cheap" | "expensive" | "neutral" {
  if (value === null) return "neutral";
  if (value <= 25) return "cheap";
  if (value >= 75) return "expensive";
  return "neutral";
}

export function SignalsPanel({ data }: Props) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            {t("signals.title")}
          </h2>
        </div>
        <p className="font-mono text-xs text-surface-400">{t("signals.loading")}</p>
      </div>
    );
  }

  const bar = scoreBarFill(data.compositeScore);
  const fallbackMsg =
    data.fallback !== "none" ? t(`signals.fallback.${data.fallback}`) : "";
  const fgClassificationLabel = data.fearGreedClassification
    ? t(`signals.classification.${data.fearGreedClassification}`, {
        defaultValue: data.fearGreedClassification,
      })
    : "";

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("signals.title")}
        </h2>
        <span className="ml-auto text-xs text-surface-400">
          {t("signals.subtitle")}
        </span>
      </div>

      {/* Three signal tiles */}
      <div className="grid grid-cols-3 gap-3">
        <SignalTile
          label={t("signals.mayerMultiple")}
          hint={t("signals.mayerHint")}
          value={formatSignalNumber(data.mayerMultiple, 2)}
          accent={accentMayer(data.mayerMultiple)}
        />
        <SignalTile
          label={t("signals.ma200w")}
          hint={t("signals.ma200wHint")}
          value={
            data.ma200wDistancePct === null
              ? "—"
              : `${data.ma200wDistancePct >= 0 ? "+" : ""}${formatSignalNumber(
                  data.ma200wDistancePct,
                  1
                )}%`
          }
          accent={accentMa200w(data.ma200wDistancePct)}
        />
        <SignalTile
          label={t("signals.fearGreed")}
          hint={fgClassificationLabel || t("signals.fearGreedHint")}
          value={formatSignalNumber(data.fearGreedIndex, 0)}
          accent={accentFearGreed(data.fearGreedIndex)}
        />
      </div>

      {/* Composite bar */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-surface-400">
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            {t("signals.composite")}
          </span>
          <span className="font-mono tabular-nums">
            {data.compositeScore === null
              ? "—"
              : `${data.compositeScore >= 0 ? "+" : ""}${formatSignalNumber(
                  data.compositeScore,
                  2
                )}`}
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-800">
          {/* Zero anchor */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-surface-600" />
          <div
            className="absolute top-0 bottom-0 transition-all duration-500"
            style={{
              left: `${bar.left}%`,
              width: `${bar.width}%`,
              background: bar.color,
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-surface-500">
          <span>{t("signals.compositeScale").split("↔")[0].trim()}</span>
          <span>{t("signals.compositeScale").split("↔")[1]?.trim() ?? ""}</span>
        </div>
      </div>

      {/* Cap utilization — same % on both dashboards. */}
      {data.capUtilizationPct !== null && (
        <p className="mt-4 border-t border-surface-700/30 pt-3 font-mono text-xs text-surface-400">
          {t("signals.capUsedPct", {
            pct: data.capUtilizationPct.toFixed(0),
          })}
        </p>
      )}

      {/* Fallback badge — surfaces degraded signal state (one or more sources
          currently unavailable). */}
      {fallbackMsg && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-glow/20 bg-amber-glow/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-glow" />
          <p className="text-xs text-amber-glow/90">{fallbackMsg}</p>
        </div>
      )}
    </div>
  );
}
