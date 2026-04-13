import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Bitcoin, Clock } from "lucide-react";
import type { Order, ChartPoint } from "../lib/api.ts";
import { nextSundayLabel } from "../lib/nextBuy.ts";

interface AccumulationChartProps {
  orders?: Order[];
  points?: ChartPoint[];
}

interface DisplayPoint {
  date: string;
  btc: number;
  spent: number;
}

export function AccumulationChart({ orders, points }: AccumulationChartProps) {
  const data = useMemo<DisplayPoint[]>(() => {
    if (points) {
      return points.map((p) => ({
        date: new Date(p.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        btc: p.btc,
        spent: p.spent,
      }));
    }

    if (!orders) return [];

    const filledOrders = orders
      .filter((o) => o.status === "filled" && o.quantity)
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
        date: new Date(o.executedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        btc: parseFloat(cumulativeBtc.toFixed(8)),
        spent: parseFloat(cumulativeSpent.toFixed(2)),
      };
    });
  }, [orders, points]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            BTC Accumulation
          </h2>
          <span className="ml-auto font-mono text-xs text-surface-500">
            waiting for first fill
          </span>
        </div>
        <div className="relative flex h-56 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-surface-700/40">
          {/* Subtle ghost baseline so the rectangle doesn't feel empty */}
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
              Your stack starts here
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-xs text-surface-400">
              <Clock className="h-3 w-3" />
              First buy {nextSundayLabel()}
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
          BTC Accumulation
        </h2>
        <span className="ml-auto font-mono text-xs text-amber-glow">
          {data[data.length - 1]?.btc.toFixed(6)} BTC
        </span>
      </div>

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
          <Tooltip content={<CustomTooltip />} />
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
    </div>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload as DisplayPoint;

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 shadow-xl">
      <p className="text-xs text-surface-400">{point.date}</p>
      <p className="mt-1 font-mono text-sm font-medium text-amber-glow">
        {point.btc.toFixed(8)} BTC
      </p>
      <p className="font-mono text-xs text-surface-300">
        R${point.spent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} invested
      </p>
    </div>
  );
}
