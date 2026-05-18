import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CopySystemState } from "../../lib/api.ts";

function useSystemState() {
  return useQuery<CopySystemState>({
    queryKey: ["copy-system-state"],
    queryFn: async () => {
      const res = await fetch("/api/copy/system-state", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load system state (${res.status})`);
      return res.json();
    },
    refetchInterval: 10_000,
  });
}

export function SystemStatePanel() {
  const qc = useQueryClient();
  const { data } = useSystemState();
  if (!data) return null;

  const reset = async () => {
    if (!confirm("Re-enable bot? This clears the kill switch.")) return;
    await fetch("/api/copy/admin/reset-kill-switch", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["copy-system-state"] });
  };
  const kill = async () => {
    const reason = prompt("Manual kill reason:") ?? "manual";
    await fetch("/api/copy/admin/kill", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    qc.invalidateQueries({ queryKey: ["copy-system-state"] });
  };

  return (
    <div className={`rounded-lg border p-4 ${data.killed ? "border-red-loss/40 bg-red-loss/5" : "border-surface-800 bg-surface-800/40"}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-surface-400">System</div>
          <div className="mt-1 font-mono text-base">
            {data.killed ? <span className="text-red-loss">KILLED — {data.killedReason}</span> : <span className="text-green-gain">ARMED</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {data.killed ? (
            <button onClick={reset} className="rounded bg-green-gain/20 px-3 py-1 text-xs text-green-gain hover:bg-green-gain/30">
              Reset kill switch
            </button>
          ) : (
            <button onClick={kill} className="rounded bg-red-loss/20 px-3 py-1 text-xs text-red-loss hover:bg-red-loss/30">
              Kill now
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-surface-300 md:grid-cols-4">
        <div>
          <div className="text-surface-500">Initial capital</div>
          <div className="font-mono">{data.initialCapital ?? "—"} USDT</div>
        </div>
        <div>
          <div className="text-surface-500">Cooldown until</div>
          <div className="font-mono">{data.cooldownUntil ? new Date(data.cooldownUntil).toLocaleString() : "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">Cooldown reason</div>
          <div className="font-mono">{data.cooldownReason ?? "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">Killed at</div>
          <div className="font-mono">{data.killedAt ? new Date(data.killedAt).toLocaleString() : "—"}</div>
        </div>
      </div>
    </div>
  );
}
