import { useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  CalendarRange,
  TrendingDown,
  TrendingUp,
  Minus,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  MonthlyBreakdown,
  PublicMonthlyBreakdown,
} from "../lib/api.ts";
import {
  formatBtc,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
} from "../lib/format.ts";

type Variant = "admin" | "public";
type WindowOption = 6 | 12 | 0; // 0 = all

interface MonthlyOverviewProps {
  /**
   * Newest-first monthly rows from the API. Admin variant includes
   * orderCount / min / max; public variant strips them.
   */
  data: MonthlyBreakdown[] | PublicMonthlyBreakdown[];
  variant?: Variant;
}

export function MonthlyOverview({
  data,
  variant = "admin",
}: MonthlyOverviewProps) {
  const { t } = useTranslation();
  const [windowMonths, setWindowMonths] = useState<WindowOption>(6);

  const windowed = useMemo(() => {
    if (windowMonths === 0) return data;
    return data.slice(0, windowMonths);
  }, [data, windowMonths]);

  // Chart expects chronological order (oldest -> newest, left -> right).
  const chartData = useMemo(
    () =>
      [...windowed].reverse().map((m) => ({
        label: m.label,
        avgPrice: m.avgPrice,
        totalSpent: m.totalSpent,
      })),
    [windowed]
  );

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
        <Header />
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-surface-700/40 text-sm text-surface-400">
          {t("monthly.noFilledYet")}
        </div>
      </div>
    );
  }

  const onlyOneMonth = data.length < 2;
  const windowLabel = (w: WindowOption) =>
    w === 0
      ? t("monthly.window.all")
      : w === 6
        ? t("monthly.window.sixMonths")
        : t("monthly.window.twelveMonths");

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("monthly.monthlyOverview")}
        </h2>
        <span className="text-xs text-surface-500">
          {t("monthly.costBasisSubtitle")}
        </span>
        {!onlyOneMonth && (
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-surface-700/30 bg-surface-800/40 p-0.5">
            {([6, 12, 0] as WindowOption[]).map((w) => {
              const active = w === windowMonths;
              return (
                <button
                  key={w}
                  onClick={() => setWindowMonths(w)}
                  className={
                    "cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs transition-colors " +
                    (active
                      ? "bg-amber-glow/15 text-amber-glow"
                      : "text-surface-400 hover:text-surface-200")
                  }
                >
                  {windowLabel(w)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Card grid: newest-first */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {windowed.map((m) => (
          <MonthCard key={m.month} month={m} variant={variant} />
        ))}
      </div>

      {/* Comparison chart — only when we have more than one month */}
      {!onlyOneMonth && (
        <div className="mt-6 border-t border-surface-700/30 pt-5">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-surface-400">
              {t("monthly.avgPriceVsSpend")}
            </h3>
            <span className="text-xs text-surface-500">
              {t("monthly.lowerLineHint")}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart
              data={chartData}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1e2a4a"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{
                  fill: "#5a72a0",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={{ stroke: "#1e2a4a" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{
                  fill: "#5a72a0",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)
                }
                width={55}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{
                  fill: "#5a72a0",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)
                }
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                wrapperStyle={{
                  fontSize: 11,
                  fontFamily: "JetBrains Mono",
                  color: "#8294b8",
                }}
              />
              <Bar
                yAxisId="right"
                dataKey="totalSpent"
                name={t("monthly.spentLegend")}
                fill="#293a5e"
                radius={[4, 4, 0, 0]}
                maxBarSize={42}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="avgPrice"
                name={t("monthly.avgPriceLegend")}
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ fill: "#f59e0b", r: 3, strokeWidth: 0 }}
                activeDot={{
                  fill: "#fbbf24",
                  r: 5,
                  strokeWidth: 2,
                  stroke: "#0f1629",
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {onlyOneMonth && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-surface-500">
          <Info className="h-3 w-3" />
          {t("monthly.keepStacking")}
        </p>
      )}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center gap-2">
      <CalendarRange className="h-4 w-4 text-amber-glow" />
      <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
        {t("monthly.monthlyOverview")}
      </h2>
    </div>
  );
}

interface MonthCardProps {
  month: MonthlyBreakdown | PublicMonthlyBreakdown;
  variant: Variant;
}

function MonthCard({ month, variant }: MonthCardProps) {
  const { t } = useTranslation();
  const isAdmin = variant === "admin";
  const admin = month as MonthlyBreakdown;

  // Full month progress (roughly 4 Sundays expected per calendar month).
  const expected = 4;
  const progressPct = isAdmin
    ? Math.min((admin.orderCount / expected) * 100, 100)
    : 0;

  return (
    <div className="group relative overflow-hidden rounded-lg border border-surface-700/40 bg-surface-800/30 p-4 transition-colors hover:border-surface-600/50">
      {/* Month header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wider text-surface-400">
          {month.label}
        </p>
        <DeltaChip pct={month.vsPrevPct} />
      </div>

      {/* BTC — lead metric */}
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-bold tabular-nums text-amber-glow">
          {formatBtc(month.totalBtc, 6)}
        </span>
        <span className="text-xs text-surface-500">BTC</span>
      </div>

      {/* Spent — secondary */}
      <div className="mb-3 font-mono text-xs text-surface-300 tabular-nums">
        {formatCurrency(month.totalSpent)}{" "}
        <span className="text-surface-500">{t("monthly.invested")}</span>
      </div>

      {/* Avg price */}
      <div className="border-t border-surface-700/30 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-surface-400">{t("monthly.avgEntry")}</span>
          <span className="font-mono text-sm font-medium tabular-nums text-surface-100">
            {formatCurrencyCompact(month.avgPrice)}
          </span>
        </div>

        {isAdmin && admin.minPrice > 0 && (
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[11px] text-surface-500">{t("monthly.range")}</span>
            <span className="font-mono text-[11px] tabular-nums text-surface-400">
              {formatK(admin.minPrice)}–{formatK(admin.maxPrice)}
            </span>
          </div>
        )}
      </div>

      {/* Order count progress (admin only) */}
      {isAdmin && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-surface-500">{t("monthly.buys")}</span>
            <span className="font-mono text-[11px] tabular-nums text-surface-400">
              {admin.orderCount}
              <span className="text-surface-600"> / ~{expected}</span>
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-800">
            <div
              className="h-full rounded-full bg-amber-glow/60 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DeltaChip({ pct }: { pct: number | null }) {
  const { t } = useTranslation();
  if (pct === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-surface-700/40 bg-surface-800/50 px-2 py-0.5 font-mono text-[10px] text-surface-500">
        <Minus className="h-2.5 w-2.5" />
        {t("monthly.baseline")}
      </span>
    );
  }

  // For DCA: cheaper entry (negative delta) is GOOD → green.
  const cheaper = pct < 0;
  const flat = Math.abs(pct) < 0.05;

  if (flat) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-surface-700/40 bg-surface-800/50 px-2 py-0.5 font-mono text-[10px] text-surface-400">
        <Minus className="h-2.5 w-2.5" />
        {t("monthly.flat")}
      </span>
    );
  }

  const cls = cheaper
    ? "border-green-gain/30 bg-green-gain/10 text-green-gain"
    : "border-red-loss/30 bg-red-loss/10 text-red-loss";
  const Arrow = cheaper ? TrendingDown : TrendingUp;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] ${cls}`}
      title={
        cheaper ? t("monthly.cheaperEntry") : t("monthly.moreExpensiveEntry")
      }
    >
      <Arrow className="h-2.5 w-2.5" />
      {cheaper ? "" : "+"}
      {formatPercent(pct)}%
    </span>
  );
}

function formatK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function CustomTooltip({ active, payload, label }: any) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const avg = payload.find((p: any) => p.dataKey === "avgPrice")?.value ?? 0;
  const spent =
    payload.find((p: any) => p.dataKey === "totalSpent")?.value ?? 0;

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 shadow-xl">
      <p className="font-mono text-xs uppercase tracking-wider text-surface-400">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-medium text-amber-glow tabular-nums">
        {formatCurrencyCompact(avg)}
        <span className="ml-1 text-[11px] text-surface-500">
          {t("monthly.avgSuffix")}
        </span>
      </p>
      <p className="font-mono text-xs text-surface-300 tabular-nums">
        {formatCurrency(spent)}
        <span className="ml-1 text-[11px] text-surface-500">
          {t("monthly.spentSuffix")}
        </span>
      </p>
    </div>
  );
}
