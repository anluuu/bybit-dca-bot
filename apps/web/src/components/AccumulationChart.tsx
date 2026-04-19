import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Bitcoin, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Order, ChartPoint } from "../lib/api.ts";
import { nextSundayLabel } from "../lib/nextBuy.ts";
import { formatBtc, formatCurrency, formatDateShort } from "../lib/format.ts";

type Mode = "btc" | "mayer" | "ma200w";

interface AccumulationChartProps {
  orders?: Order[];
  points?: ChartPoint[];
}

interface DisplayPoint {
  date: string;
  btc: number;
  spent: number;
  /** Mayer Multiple at this point. Null for rows pre-signal-capture. */
  mayer: number | null;
  /** 200W MA distance %. Null for rows pre-signal-capture. */
  ma200w: number | null;
}

export function AccumulationChart({ orders, points }: AccumulationChartProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("btc");

  const data = useMemo<DisplayPoint[]>(() => {
    // Public path: server has already pre-summed the cumulative series.
    if (points) {
      return points.map((p) => ({
        date: formatDateShort(p.date),
        btc: p.btc,
        spent: p.spent,
        mayer: p.mayer,
        ma200w: p.ma200wDistancePct,
      }));
    }

    // Admin path: derive cumulative series from raw Order rows. Test orders
    // are tagged is_test=true on the server and must be excluded here so the
    // admin chart matches `/api/orders/summary` (which filters server-side)
    // and the public chart (pre-filtered by `/api/public/chart`). Missing
    // this filter inflated admin totals by every test order the operator
    // fired from TestOrderCard.
    if (!orders) return [];

    const filledOrders = orders
      .filter((o) => o.status === "filled" && !o.isTest && o.quantity)
      .sort(
        (a, b) =>
          new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
      );

    let cumulativeBtc = 0;
    let cumulativeSpent = 0;

    return filledOrders.map<DisplayPoint>((o) => {
      cumulativeBtc += parseFloat(o.quantity!);
      cumulativeSpent += parseFloat(o.fiatSpent!);
      return {
        date: formatDateShort(o.executedAt),
        btc: parseFloat(cumulativeBtc.toFixed(8)),
        spent: parseFloat(cumulativeSpent.toFixed(2)),
        mayer: o.mayerMultiple ? parseFloat(o.mayerMultiple) : null,
        ma200w: o.ma200wDistancePct ? parseFloat(o.ma200wDistancePct) : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, points]);

  // Whether each overlay mode has at least one non-null value — controls
  // whether the toggle button is enabled. Historical-only datasets with no
  // signal data should hide the toggles.
  const hasMayer = data.some((d) => d.mayer !== null);
  const hasMa200w = data.some((d) => d.ma200w !== null);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            {t("chart.btcAccumulation")}
          </h2>
          <span className="ml-auto font-mono text-xs text-surface-500">
            {t("chart.waitingFirstFill")}
          </span>
        </div>
        <div className="relative flex h-56 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-surface-700/40">
          <svg
            className="absolute inset-x-0 bottom-0 h-full w-full opacity-30"
            preserveAspectRatio="none"
            viewBox="0 0 100 40"
          >
            <defs>
              <linearGradient id="ghostGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path
              d="M0 38 L15 34 L30 30 L45 25 L60 18 L75 12 L100 4 L100 40 L0 40 Z"
              fill="url(#ghostGrad)"
            />
            <path
              d="M0 38 L15 34 L30 30 L45 25 L60 18 L75 12 L100 4"
              fill="none"
              stroke="#f59e0b"
              strokeOpacity={0.35}
              strokeWidth={0.6}
              strokeDasharray="1.5 1.5"
            />
          </svg>
          <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-amber-glow/20 bg-surface-900/80">
            <Bitcoin className="h-5 w-5 text-amber-glow" />
          </div>
          <div className="relative z-10 text-center">
            <p className="text-sm font-medium text-surface-200">
              {t("chart.stackStartsHere")}
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-xs text-surface-400">
              <Clock className="h-3 w-3" />
              {t("chart.firstBuy", { when: nextSundayLabel() })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("chart.btcAccumulation")}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <ModeButton
            label={t("chart.modeBtc")}
            active={mode === "btc"}
            onClick={() => setMode("btc")}
          />
          <ModeButton
            label={t("chart.modeMayer")}
            active={mode === "mayer"}
            onClick={() => setMode("mayer")}
            disabled={!hasMayer}
          />
          <ModeButton
            label={t("chart.modeMa200w")}
            active={mode === "ma200w"}
            onClick={() => setMode("ma200w")}
            disabled={!hasMa200w}
          />
        </div>
      </div>

      {mode === "btc" && (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="btcGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1e2a4a"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "#1e2a4a" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(4)}
              width={65}
            />
            <Tooltip content={<CustomTooltip mode={mode} />} />
            <Area
              type="monotone"
              dataKey="btc"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#btcGradient)"
              dot={{ fill: "#f59e0b", r: 3, strokeWidth: 0 }}
              activeDot={{ fill: "#fbbf24", r: 5, strokeWidth: 2, stroke: "#0f1629" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {mode === "mayer" && (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1e2a4a"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "#1e2a4a" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={50}
              domain={["auto", "auto"]}
            />
            {/* Reference bands: historical Mayer Multiple regimes. Bottom
                shaded region = "cheap" zone (≤ 0.8), top = "hot" zone (≥ 2.4). */}
            <ReferenceArea
              y1={0}
              y2={0.8}
              fill="#22c55e"
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
            <ReferenceArea
              y1={2.4}
              y2={100}
              fill="#ef4444"
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
            <ReferenceLine y={1} stroke="#5a72a0" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip mode={mode} />} />
            <Line
              type="monotone"
              dataKey="mayer"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: "#8b5cf6", r: 3, strokeWidth: 0 }}
              activeDot={{ fill: "#a78bfa", r: 5, strokeWidth: 2, stroke: "#0f1629" }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {mode === "ma200w" && (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1e2a4a"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "#1e2a4a" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5a72a0", fontSize: 11, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={55}
              domain={["auto", "auto"]}
            />
            {/* 0% = at the 200-week MA. Below is historically the floor. */}
            <ReferenceLine y={0} stroke="#5a72a0" strokeDasharray="3 3" />
            <ReferenceArea
              y1={-100}
              y2={-20}
              fill="#22c55e"
              fillOpacity={0.06}
              ifOverflow="extendDomain"
            />
            <Tooltip content={<CustomTooltip mode={mode} />} />
            <Line
              type="monotone"
              dataKey="ma200w"
              stroke="#22c55e"
              strokeWidth={2}
              dot={{ fill: "#22c55e", r: 3, strokeWidth: 0 }}
              activeDot={{ fill: "#4ade80", r: 5, strokeWidth: 2, stroke: "#0f1629" }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "border-amber-glow/40 bg-amber-glow/10 text-amber-glow"
          : "border-surface-700/30 bg-surface-800/40 text-surface-400 hover:text-surface-200"
      } disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-surface-400`}
    >
      {label}
    </button>
  );
}

function CustomTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: DisplayPoint }>;
  mode: Mode;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 shadow-xl">
      <p className="text-xs text-surface-400">{point.date}</p>
      {mode === "btc" && (
        <>
          <p className="mt-1 font-mono text-sm font-medium text-amber-glow">
            {formatBtc(point.btc)} BTC
          </p>
          <p className="font-mono text-xs text-surface-300">
            {t("chart.invested", { amount: formatCurrency(point.spent) })}
          </p>
        </>
      )}
      {mode === "mayer" && (
        <p className="mt-1 font-mono text-sm font-medium text-violet-tech">
          Mayer {point.mayer !== null ? point.mayer.toFixed(3) : "—"}
        </p>
      )}
      {mode === "ma200w" && (
        <p className="mt-1 font-mono text-sm font-medium text-green-gain">
          200W {point.ma200w !== null ? `${point.ma200w.toFixed(1)}%` : "—"}
        </p>
      )}
    </div>
  );
}
