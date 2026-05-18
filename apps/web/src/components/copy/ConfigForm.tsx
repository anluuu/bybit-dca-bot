import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CopyConfig } from "../../lib/api.ts";

function useConfig() {
  return useQuery<CopyConfig>({
    queryKey: ["copy-config"],
    queryFn: async () => {
      const res = await fetch("/api/copy/config", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

const KEY_LABEL: Record<string, string> = {
  MAX_RISK_PCT: "Max risk %",
  MAX_LEVERAGE: "Max leverage",
  MAX_OPEN_POSITIONS: "Max open positions",
  DAILY_LOSS_LIMIT_PCT: "Daily loss limit %",
  MAX_DRAWDOWN_PCT: "Max drawdown %",
  COOLDOWN_MIN_AFTER_LOSS: "Cooldown (min)",
  CHASE_TOLERANCE_PCT: "Chase tolerance %",
  CHASE_TIMEOUT_MIN: "Chase timeout (min)",
  MIN_RR_RATIO: "Min R:R",
  WHITELIST_SYMBOLS: "Whitelist (CSV)",
  DRY_RUN: "Dry run",
};

export function ConfigForm() {
  const qc = useQueryClient();
  const { data } = useConfig();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!data) return null;
  const keys = Object.keys(KEY_LABEL);

  async function save(key: string, value: string) {
    const res = await fetch(`/api/copy/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErrors((e) => ({ ...e, [key]: body.error ?? `HTTP ${res.status}` }));
      return;
    }
    setErrors((e) => ({ ...e, [key]: "" }));
    setDrafts((d) => ({ ...d, [key]: "" }));
    qc.invalidateQueries({ queryKey: ["copy-config"] });
  }

  return (
    <div className="rounded-lg border border-surface-800 bg-surface-800/40 p-4">
      <div className="mb-3 text-xs uppercase text-surface-400">Config</div>
      <div className="space-y-2">
        {keys.map((k) => {
          const current = data[k] ?? "";
          const draft = drafts[k];
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <label className="w-48 text-surface-300">{KEY_LABEL[k]}</label>
              <input
                className="rounded bg-surface-900 px-2 py-1 font-mono text-xs text-surface-100"
                value={draft ?? current}
                onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
              />
              <button
                onClick={() => save(k, draft ?? current)}
                disabled={draft == null || draft === current}
                className="rounded bg-amber-glow/20 px-2 py-1 text-xs text-amber-glow disabled:opacity-40"
              >
                Save
              </button>
              {errors[k] && <span className="text-xs text-red-loss">{errors[k]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
