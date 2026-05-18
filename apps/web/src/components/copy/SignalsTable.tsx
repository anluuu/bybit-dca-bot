import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { CopySignalsPage } from "../../lib/api.ts";

function useCopySignals(page: number, status?: string) {
  return useQuery<CopySignalsPage>({
    queryKey: ["copy-signals", page, status ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (status) params.set("status", status);
      const res = await fetch(`/api/copy/signals?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load signals (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function SignalsTable() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const { data, isLoading, error } = useCopySignals(page, status || undefined);

  if (isLoading && !data) return <div className="p-4 text-gray-500">Loading…</div>;
  if (error) return <div className="p-4 text-red-500">Error: {String(error)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-400">Status:</label>
        <select
          className="rounded bg-surface-800 px-2 py-1 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="PARSED">Parsed</option>
          <option value="UNPARSEABLE">Unparseable</option>
          <option value="SKIPPED">Skipped</option>
          <option value="EXECUTED">Executed</option>
        </select>
        <span className="text-xs text-gray-500">{data.total} total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm font-mono">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">Received</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Dir</th>
              <th className="px-2 py-2 text-left">Symbol</th>
              <th className="px-2 py-2 text-right">Entry Low</th>
              <th className="px-2 py-2 text-right">Entry High</th>
              <th className="px-2 py-2 text-right">SL</th>
              <th className="px-2 py-2 text-right">Lev</th>
              <th className="px-2 py-2 text-right">TP1</th>
              <th className="px-2 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id} className="border-t border-surface-700/10">
                <td className="px-2 py-1 whitespace-nowrap">
                  {new Date(s.receivedAt).toLocaleString()}
                </td>
                <td className="px-2 py-1">{s.status}</td>
                <td className="px-2 py-1">{s.direction ?? "—"}</td>
                <td className="px-2 py-1">{s.symbol ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.entryLow ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.entryHigh ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.stopLoss ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.leverageRaw ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.takeProfit1 ?? "—"}</td>
                <td className="px-2 py-1 text-left text-amber-glow">
                  {s.skipReason ?? ""}
                </td>
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
        <span className="text-xs text-gray-500">
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
