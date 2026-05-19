import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CopyConfig } from "../../lib/api.ts";

const CONFIG_KEYS = [
  "MAX_RISK_PCT",
  "MAX_LEVERAGE",
  "MAX_OPEN_POSITIONS",
  "DAILY_LOSS_LIMIT_PCT",
  "MAX_DRAWDOWN_PCT",
  "COOLDOWN_MIN_AFTER_LOSS",
  "CHASE_TOLERANCE_PCT",
  "CHASE_TIMEOUT_MIN",
  "MIN_RR_RATIO",
  "WHITELIST_SYMBOLS",
  "DRY_RUN",
] as const;

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

export function ConfigForm() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useConfig();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!data) return null;

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
      <div className="mb-3 text-xs uppercase text-surface-400">{t("copy.config.heading")}</div>
      <div className="space-y-2">
        {CONFIG_KEYS.map((k) => {
          const current = data[k] ?? "";
          const draft = drafts[k];
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <label className="w-48 text-surface-300">{t(`copy.config.labels.${k}`)}</label>
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
                {t("copy.config.save")}
              </button>
              {errors[k] && <span className="text-xs text-red-loss">{errors[k]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
