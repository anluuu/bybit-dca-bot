import { useQuery } from "@tanstack/react-query";
import type { CopyStats } from "../../lib/api.ts";

function useCopyStats() {
  return useQuery<CopyStats>({
    queryKey: ["copy-stats"],
    queryFn: async () => {
      const res = await fetch("/api/copy/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} USDT`;
}

function pnlTone(n: number): string {
  if (n > 0) return "text-green-gain";
  if (n < 0) return "text-red-loss";
  return "text-surface-300";
}

export function StatsCard() {
  const { data, isLoading, error } = useCopyStats();
  if (isLoading) return <div className="rounded-lg bg-surface-800/40 p-4 text-surface-400">Loading stats…</div>;
  if (error || !data) return null;
  const winRate = data.wins + data.losses === 0 ? 0 : (data.wins / (data.wins + data.losses)) * 100;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Today" value={fmtUsd(data.today.pnlUsdt)} tone={pnlTone(data.today.pnlUsdt)} />
      <Stat label="7d" value={fmtUsd(data.last7.pnlUsdt)} tone={pnlTone(data.last7.pnlUsdt)} />
      <Stat label="All-time" value={fmtUsd(data.allTime.pnlUsdt)} tone={pnlTone(data.allTime.pnlUsdt)} />
      <Stat label="Win rate" value={`${winRate.toFixed(0)}% (${data.wins}/${data.wins + data.losses})`} tone="text-surface-200" />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-surface-800 bg-surface-800/40 p-3">
      <div className="text-xs uppercase text-surface-400">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone}`}>{value}</div>
    </div>
  );
}
