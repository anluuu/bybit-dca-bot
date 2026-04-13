import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  Play,
  AlertTriangle,
  CircleCheck,
  CircleX,
  Loader2,
  Activity,
  ShieldAlert,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TestOrderPreview, TestOrderResult } from "../lib/api.ts";
import {
  formatBtc,
  formatCurrency,
  formatCurrencyCompact,
  formatPercent,
} from "../lib/format.ts";

interface TestOrderCardProps {
  pair: string;
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

export function TestOrderCard({ pair }: TestOrderCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedPair, setTypedPair] = useState("");

  const preview = useMutation<TestOrderPreview, Error, void>({
    mutationFn: () => postJson<TestOrderPreview>("/api/test/preview", { pair }),
  });

  const execute = useMutation<TestOrderResult, Error, void>({
    mutationFn: () => postJson<TestOrderResult>("/api/test/execute", { pair }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      setConfirmOpen(false);
      setTypedPair("");
    },
  });

  const previewData = preview.data;
  const result = execute.data;
  const slippagePct =
    previewData && result?.price
      ? ((parseFloat(result.price) - previewData.currentPrice) /
          previewData.currentPrice) *
        100
      : null;

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-violet-tech" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          {t("test.testOrder")}
        </h2>
        <span className="ml-auto rounded-md border border-violet-tech/20 bg-violet-tech/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-tech">
          {t("test.operatorOnly")}
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-surface-400">
        {t("test.description")}
      </p>

      {/* Preview panel */}
      {!previewData && !preview.isPending && (
        <button
          onClick={() => preview.mutate()}
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-surface-700/40 bg-surface-800/40 px-4 py-2.5 text-sm font-medium text-surface-200 transition-all hover:border-amber-glow/40 hover:bg-surface-800/80 hover:text-amber-glow"
        >
          <Activity className="h-4 w-4" />
          {t("test.generatePreview")}
        </button>
      )}

      {preview.isPending && (
        <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-surface-700/40 bg-surface-800/40 px-4 py-2.5 text-sm text-surface-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("test.fetchingTicker")}
        </div>
      )}

      {preview.isError && !previewData && (
        <div className="flex items-start gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-3 py-2.5 text-sm text-red-loss">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-xs">{preview.error.message}</span>
        </div>
      )}

      {previewData && (
        <div className="space-y-4">
          {/* Numbers grid */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-surface-700/30 bg-surface-800/40 p-4">
            <PreviewStat
              label={t("test.tickerNow")}
              value={formatCurrencyCompact(previewData.currentPrice)}
            />
            <PreviewStat
              label={t("test.testAmount")}
              value={formatCurrency(previewData.testAmountBrl)}
              accent
            />
            <PreviewStat
              label={t("test.estBtc")}
              value={formatBtc(previewData.estimatedQty)}
              accent
            />
          </div>

          {/* Busy / ready gate */}
          {previewData.busy ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-glow/30 bg-amber-glow/10 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-glow" />
              <div>
                <p className="text-xs font-medium text-amber-glow">
                  {t("test.executionBlocked")}
                </p>
                <p className="mt-0.5 text-xs text-amber-glow/70">
                  {previewData.busyReason}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => preview.mutate()}
                disabled={preview.isPending}
                className="cursor-pointer rounded-md px-3 py-1.5 font-mono text-xs text-surface-400 transition-colors hover:text-surface-200 disabled:cursor-wait"
              >
                {t("test.refreshPreview")}
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={execute.isPending}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-4 py-2 text-sm font-medium text-red-loss transition-all hover:border-red-loss/50 hover:bg-red-loss/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {t("test.executeReal")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Result panel */}
      {result && (
        <div className="mt-4 rounded-lg border border-surface-700/30 bg-surface-800/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            {result.status === "filled" ? (
              <>
                <CircleCheck className="h-4 w-4 text-green-gain" />
                <span className="text-sm font-medium text-green-gain">
                  {t("test.filled")}
                </span>
              </>
            ) : (
              <>
                <CircleX className="h-4 w-4 text-red-loss" />
                <span className="text-sm font-medium text-red-loss">
                  {t("test.otherStatus", {
                    status: t(`orderStatus.${result.status}`, {
                      defaultValue: result.status,
                    }),
                  })}
                </span>
              </>
            )}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-surface-400">
              #{result.orderId}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultStat
              label={t("test.filledPrice")}
              value={
                result.price
                  ? formatCurrencyCompact(parseFloat(result.price))
                  : "—"
              }
            />
            <ResultStat
              label={t("test.btc")}
              value={result.quantity ? formatBtc(parseFloat(result.quantity)) : "—"}
              accent
            />
            <ResultStat
              label={t("test.spent")}
              value={
                result.fiatSpent
                  ? formatCurrency(parseFloat(result.fiatSpent))
                  : "—"
              }
            />
            <ResultStat
              label={t("test.fee")}
              value={
                result.fee
                  ? `${formatBtc(parseFloat(result.fee))} ${result.feeCurrency ?? ""}`.trim()
                  : "—"
              }
            />
          </div>

          {result.status === "filled" && slippagePct !== null && (
            <div className="mt-3 flex items-center justify-between border-t border-surface-700/30 pt-3">
              <span className="text-xs text-surface-400">
                {t("test.slippageLabel")}
              </span>
              <span
                className={`font-mono text-xs tabular-nums ${
                  Math.abs(slippagePct) < 0.1
                    ? "text-surface-300"
                    : slippagePct > 0
                      ? "text-red-loss"
                      : "text-green-gain"
                }`}
              >
                {slippagePct >= 0 ? "+" : ""}
                {formatPercent(slippagePct, 3)}%
              </span>
            </div>
          )}

          {result.status !== "filled" && result.errorMessage && (
            <div className="mt-3 border-t border-surface-700/30 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-surface-500">
                {t("test.errorFromBybit")}
              </p>
              <p className="mt-1 break-words font-mono text-xs leading-relaxed text-red-loss">
                {result.errorMessage}
              </p>
            </div>
          )}
        </div>
      )}

      {execute.isError && !result && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-loss" />
          <div>
            <p className="text-xs font-medium text-red-loss">
              {t("test.executionFailed")}
            </p>
            <p className="mt-0.5 text-xs text-red-loss/70">
              {execute.error.message}
            </p>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen && previewData && (
        <ConfirmModal
          pair={pair}
          amount={previewData.testAmountBrl}
          typedPair={typedPair}
          onTypedPairChange={setTypedPair}
          onCancel={() => {
            setConfirmOpen(false);
            setTypedPair("");
          }}
          onConfirm={() => execute.mutate()}
          isPending={execute.isPending}
        />
      )}
    </div>
  );
}

function PreviewStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-surface-500">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-sm font-medium tabular-nums ${
          accent ? "text-amber-glow" : "text-surface-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ResultStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-surface-500">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${
          accent ? "text-amber-glow" : "text-surface-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ConfirmModal({
  pair,
  amount,
  typedPair,
  onTypedPairChange,
  onCancel,
  onConfirm,
  isPending,
}: {
  pair: string;
  amount: number;
  typedPair: string;
  onTypedPairChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const unlocked = typedPair.trim().toUpperCase() === pair.toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-900 p-6 shadow-2xl">
        <button
          onClick={onCancel}
          disabled={isPending}
          className="absolute top-3 right-3 cursor-pointer rounded p-1 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200 disabled:cursor-not-allowed"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-loss/10 border border-red-loss/30">
            <AlertTriangle className="h-4 w-4 text-red-loss" />
          </div>
          <h3 className="text-base font-semibold text-surface-100">
            {t("test.confirmTitle")}
          </h3>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-surface-300">
          {t("test.confirmBody", {
            amount: formatCurrency(amount),
            pair,
          })}
        </p>

        <label className="mb-2 block text-xs uppercase tracking-wider text-surface-400">
          {t("test.typePairToConfirm", { pair })}
        </label>
        <input
          type="text"
          value={typedPair}
          onChange={(e) => onTypedPairChange(e.target.value)}
          disabled={isPending}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder={pair}
          className="mb-4 w-full rounded-md border border-surface-700/50 bg-surface-800/60 px-3 py-2 font-mono text-sm text-surface-100 outline-none placeholder:text-surface-500 focus:border-amber-glow/40 disabled:opacity-60"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="cursor-pointer rounded-md border border-surface-700/40 bg-surface-800/40 px-4 py-2 text-sm text-surface-300 transition-colors hover:border-surface-500/40 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("test.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={!unlocked || isPending}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-red-loss/40 bg-red-loss/20 px-4 py-2 text-sm font-medium text-red-loss transition-all hover:bg-red-loss/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("test.placing")}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                {t("test.placeOrder")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
