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
import type { TestOrderPreview, TestOrderResult } from "../lib/api.ts";

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
          Test Order
        </h2>
        <span className="ml-auto rounded-md border border-violet-tech/20 bg-violet-tech/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-violet-tech">
          operator only
        </span>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-surface-400">
        Places a small real market order to verify Bybit credentials, price
        math, and order flow. Excluded from monthly cap and dashboard totals.
      </p>

      {/* Preview panel */}
      {!previewData && !preview.isPending && (
        <button
          onClick={() => preview.mutate()}
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-surface-700/40 bg-surface-800/40 px-4 py-2.5 text-sm font-medium text-surface-200 transition-all hover:border-amber-glow/40 hover:bg-surface-800/80 hover:text-amber-glow"
        >
          <Activity className="h-4 w-4" />
          Generate preview
        </button>
      )}

      {preview.isPending && (
        <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-surface-700/40 bg-surface-800/40 px-4 py-2.5 text-sm text-surface-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Fetching ticker…
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
              label="Ticker Now"
              value={`R$${previewData.currentPrice.toLocaleString("pt-BR", {
                maximumFractionDigits: 0,
              })}`}
            />
            <PreviewStat
              label="Test Amount"
              value={`R$${previewData.testAmountBrl.toFixed(2)}`}
              accent
            />
            <PreviewStat
              label="Est. BTC"
              value={previewData.estimatedQty.toFixed(8)}
              accent
            />
          </div>

          {/* Busy / ready gate */}
          {previewData.busy ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-glow/30 bg-amber-glow/10 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-glow" />
              <div>
                <p className="text-xs font-medium text-amber-glow">
                  Execution blocked
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
                Refresh preview
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={execute.isPending}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-loss/30 bg-red-loss/10 px-4 py-2 text-sm font-medium text-red-loss transition-all hover:border-red-loss/50 hover:bg-red-loss/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Execute real test order
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
                  Test order filled
                </span>
              </>
            ) : (
              <>
                <CircleX className="h-4 w-4 text-red-loss" />
                <span className="text-sm font-medium text-red-loss">
                  Test order {result.status}
                </span>
              </>
            )}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-surface-400">
              #{result.orderId}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultStat
              label="Filled Price"
              value={
                result.price
                  ? `R$${parseFloat(result.price).toLocaleString("pt-BR", {
                      maximumFractionDigits: 0,
                    })}`
                  : "—"
              }
            />
            <ResultStat
              label="BTC"
              value={result.quantity ? parseFloat(result.quantity).toFixed(8) : "—"}
              accent
            />
            <ResultStat
              label="Spent"
              value={result.fiatSpent ? `R$${parseFloat(result.fiatSpent).toFixed(2)}` : "—"}
            />
            <ResultStat
              label="Fee"
              value={
                result.fee
                  ? `${parseFloat(result.fee).toFixed(8)} ${result.feeCurrency ?? ""}`.trim()
                  : "—"
              }
            />
          </div>

          {result.status === "filled" && slippagePct !== null && (
            <div className="mt-3 flex items-center justify-between border-t border-surface-700/30 pt-3">
              <span className="text-xs text-surface-400">
                Slippage vs preview
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
                {slippagePct.toFixed(3)}%
              </span>
            </div>
          )}

          {result.status !== "filled" && result.errorMessage && (
            <div className="mt-3 border-t border-surface-700/30 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-surface-500">
                Error from Bybit
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
              Execution failed
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
            Confirm real test order
          </h3>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-surface-300">
          This will place a real market buy on Bybit for{" "}
          <span className="font-mono font-medium text-amber-glow">
            R${amount.toFixed(2)}
          </span>{" "}
          of{" "}
          <span className="font-mono font-medium text-surface-100">{pair}</span>.
          The trade will incur fees and the BTC will remain in your Bybit spot
          wallet.
        </p>

        <label className="mb-2 block text-xs uppercase tracking-wider text-surface-400">
          Type <span className="font-mono text-surface-200">{pair}</span> to
          confirm
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
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!unlocked || isPending}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-red-loss/40 bg-red-loss/20 px-4 py-2 text-sm font-medium text-red-loss transition-all hover:bg-red-loss/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Placing…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                Place real order
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
