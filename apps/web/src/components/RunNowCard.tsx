import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw,
  AlertTriangle,
  CircleCheck,
  Loader2,
  PlayCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminRunNowResult, Order } from "../lib/api.ts";

interface RunNowCardProps {
  pair: string;
  orders: Order[];
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Locate the most recent NON-TEST order on `pair`. Run-now is only surfaced
 * when this row exists and its status is "failed" — otherwise the button is
 * disabled to prevent accidental double-buys on a healthy schedule.
 */
function lastRealOrder(orders: Order[], pair: string): Order | null {
  for (const o of orders) {
    if (!o.isTest && o.pair === pair) return o;
  }
  return null;
}

export function RunNowCard({ pair, orders }: RunNowCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const last = lastRealOrder(orders, pair);
  const lastFailed = last?.status === "failed";

  const execute = useMutation<AdminRunNowResult, Error, void>({
    mutationFn: () => postJson<AdminRunNowResult>("/api/admin/run-now", { pair }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      setConfirmOpen(false);
    },
  });

  const result = execute.data;
  const disabledReason = !last
    ? t("runNow.noHistory")
    : !lastFailed
      ? t("runNow.lastNotFailed", {
          status: t(`orderStatus.${last.status}`, { defaultValue: last.status }),
        })
      : null;

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("runNow.title")}
        </h2>
        <span className="ml-auto rounded-md border border-amber-glow/20 bg-amber-glow/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-glow">
          {t("runNow.operatorOnly")}
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-surface-400">
        {t("runNow.description")}
      </p>

      {result ? (
        <div className="flex items-start gap-2 rounded-lg border border-green-gain/30 bg-green-gain/10 px-3 py-2.5">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-gain" />
          <div>
            <p className="text-xs font-medium text-green-gain">
              {t("runNow.started")}
            </p>
            <p className="mt-0.5 text-xs text-green-gain/70">
              {t("runNow.startedDetail")}
            </p>
          </div>
        </div>
      ) : disabledReason ? (
        <div className="flex items-start gap-2 rounded-lg border border-surface-700/40 bg-surface-800/40 px-3 py-2.5">
          <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-surface-500" />
          <p className="text-xs text-surface-400">{disabledReason}</p>
        </div>
      ) : (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={execute.isPending}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-amber-glow/40 bg-amber-glow/10 px-4 py-2.5 text-sm font-medium text-amber-glow transition-all hover:border-amber-glow/60 hover:bg-amber-glow/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {execute.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("runNow.starting")}
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" />
              {t("runNow.retry")}
            </>
          )}
        </button>
      )}

      {last?.errorMessage && !result && (
        <div className="mt-4 border-t border-surface-700/30 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-surface-500">
            {t("runNow.lastErrorLabel")}
          </p>
          <p className="mt-1 break-words font-mono text-xs leading-relaxed text-red-loss">
            {last.errorMessage}
          </p>
        </div>
      )}

      {execute.isError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-loss" />
          <div>
            <p className="text-xs font-medium text-red-loss">
              {t("runNow.failedToStart")}
            </p>
            <p className="mt-0.5 text-xs text-red-loss/70">
              {execute.error.message}
            </p>
          </div>
        </div>
      )}

      {confirmOpen && (
        <ConfirmDialog
          pair={pair}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => execute.mutate()}
          isPending={execute.isPending}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  pair,
  onCancel,
  onConfirm,
  isPending,
}: {
  pair: string;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-glow/30 bg-amber-glow/10">
            <AlertTriangle className="h-4 w-4 text-amber-glow" />
          </div>
          <h3 className="text-base font-semibold text-surface-100">
            {t("runNow.confirmTitle")}
          </h3>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-surface-300">
          {t("runNow.confirmBody", { pair })}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="cursor-pointer rounded-md border border-surface-700/40 bg-surface-800/40 px-4 py-2 text-sm text-surface-300 transition-colors hover:border-surface-500/40 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("runNow.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-amber-glow/40 bg-amber-glow/20 px-4 py-2 text-sm font-medium text-amber-glow transition-all hover:bg-amber-glow/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("runNow.starting")}
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5" />
                {t("runNow.confirm")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
