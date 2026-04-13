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
import { TrendingUp } from "lucide-react";
import type { Order } from "../lib/api.ts";

interface AccumulationChartProps {
  orders: Order[];
}

interface ChartPoint {
  date: string;
  btc: number;
  spent: number;
}

export function AccumulationChart({ orders }: AccumulationChartProps) {
  const data = useMemo(() => {
    const filledOrders = orders
      .filter((o) => o.status === "filled" && o.quantity)
      .sort(
        (a, b) =>
          new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
      );

    let cumulativeBtc = 0;
    let cumulativeSpent = 0;

    return filledOrders.map<ChartPoint>((o) => {
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
  }, [orders]);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-surface-700/50 bg-surface-900/80 p-5">
        <p className="text-sm text-surface-400">No filled orders yet</p>
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

  const point = payload[0].payload as ChartPoint;

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
