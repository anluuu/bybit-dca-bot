import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { CopyTradesPage } from "../../lib/api.ts";

function useCopyTrades(page: number, status: string, includeDryRun: boolean) {
  return useQuery<CopyTradesPage>({
    queryKey: ["copy-trades", page, status, includeDryRun],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (status) params.set("status", status);
      params.set("includeDryRun", String(includeDryRun));
      const res = await fetch(`/api/copy/trades?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load trades (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function TradesTable() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [includeDryRun, setIncludeDryRun] = useState(true);
  const { data, isLoading, error } = useCopyTrades(page, status, includeDryRun);

  if (isLoading && !data) return <div className="p-4 text-surface-400">Loading…</div>;
  if (error) return <div className="p-4 text-red-loss">Error: {String(error)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-surface-400">Status:</label>
        <select
          className="rounded bg-surface-800 px-2 py-1 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="DRY_RUN_LOGGED">Dry-run logged</option>
          <option value="PENDING_FILL">Pending fill</option>
          <option value="OPEN">Open</option>
          <option value="NOT_FILLED">Not filled</option>
          <option value="CLOSED_TP">Closed TP</option>
          <option value="CLOSED_SL">Closed SL</option>
          <option value="CLOSED_MANUAL">Closed manual</option>
          <option value="LIQUIDATED">Liquidated</option>
          <option value="ERROR">Error</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-surface-400">
          <input
            type="checkbox"
            checked={includeDryRun}
            onChange={(e) => setIncludeDryRun(e.target.checked)}
          />
          Include dry-run
        </label>
        <span className="ml-auto text-xs text-surface-500">{data.total} total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm font-mono">
          <thead className="text-xs uppercase text-surface-400">
            <tr>
              <th className="px-2 py-2 text-left">Created</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-left">Symbol</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Margin</th>
              <th className="px-2 py-2 text-right">Lev</th>
              <th className="px-2 py-2 text-right">Avg Entry</th>
              <th className="px-2 py-2 text-right">Exit</th>
              <th className="px-2 py-2 text-right">PnL</th>
              <th className="px-2 py-2 text-left">Dry?</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id} className="border-t border-surface-800">
                <td className="px-2 py-1 whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1">{t.status}</td>
                <td className="px-2 py-1">{t.direction}</td>
                <td className="px-2 py-1">{t.symbol}</td>
                <td className="px-2 py-1 text-right">{t.plannedQty}</td>
                <td className="px-2 py-1 text-right">{t.plannedMargin}</td>
                <td className="px-2 py-1 text-right">{t.leverageUsed}x</td>
                <td className="px-2 py-1 text-right">{t.avgEntry ?? "—"}</td>
                <td className="px-2 py-1 text-right">{t.exitPrice ?? "—"}</td>
                <td className={`px-2 py-1 text-right ${Number(t.pnlUsdt ?? 0) > 0 ? "text-green-gain" : Number(t.pnlUsdt ?? 0) < 0 ? "text-red-loss" : ""}`}>
                  {t.pnlUsdt ?? "—"}
                </td>
                <td className="px-2 py-1 text-amber-glow">{t.dryRun ? "DRY" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="text-xs text-surface-500">
          Page {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
        </span>
        <button
          className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
          onClick={() => setPage((p) => p + 1)}
          disabled={page * data.pageSize >= data.total}
        >
          Next
        </button>
      </div>
    </div>
  );
}
