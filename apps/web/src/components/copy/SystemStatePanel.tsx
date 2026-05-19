import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CopySystemState } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";

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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useSystemState();
  if (!data) return null;

  const reset = async () => {
    if (!confirm(t("copy.systemState.confirmReset"))) return;
    await fetch("/api/copy/admin/reset-kill-switch", { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["copy-system-state"] });
  };
  const kill = async () => {
    const reason = prompt(t("copy.systemState.promptKillReason")) ?? t("copy.systemState.defaultKillReason");
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
          <div className="text-xs uppercase text-surface-400">{t("copy.systemState.heading")}</div>
          <div className="mt-1 font-mono text-base">
            {data.killed ? (
              <span className="text-red-loss">
                {t("copy.systemState.killed", { reason: data.killedReason })}
              </span>
            ) : (
              <span className="text-green-gain">{t("copy.systemState.armed")}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {data.killed ? (
            <button onClick={reset} className="rounded bg-green-gain/20 px-3 py-1 text-xs text-green-gain hover:bg-green-gain/30">
              {t("copy.systemState.resetKill")}
            </button>
          ) : (
            <button onClick={kill} className="rounded bg-red-loss/20 px-3 py-1 text-xs text-red-loss hover:bg-red-loss/30">
              {t("copy.systemState.killNow")}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-surface-300 md:grid-cols-4">
        <div>
          <div className="text-surface-500">{t("copy.systemState.initialCapital")}</div>
          <div className="font-mono">{data.initialCapital ?? "—"} USDT</div>
        </div>
        <div>
          <div className="text-surface-500">{t("copy.systemState.cooldownUntil")}</div>
          <div className="font-mono">{data.cooldownUntil ? formatDateTime(data.cooldownUntil) : "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">{t("copy.systemState.cooldownReason")}</div>
          <div className="font-mono">{data.cooldownReason ?? "—"}</div>
        </div>
        <div>
          <div className="text-surface-500">{t("copy.systemState.killedAt")}</div>
          <div className="font-mono">{data.killedAt ? formatDateTime(data.killedAt) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
