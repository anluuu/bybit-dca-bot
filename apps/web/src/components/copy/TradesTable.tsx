import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CopyTradesPage, CopyTradeStatus } from "../../lib/api.ts";
import { formatDateTime, pnlTone } from "../../lib/format.ts";
import { Pagination } from "./Pagination.tsx";
import { StatusFilter } from "./StatusFilter.tsx";

const TRADE_STATUSES: readonly CopyTradeStatus[] = [
  "DRY_RUN_LOGGED",
  "PENDING_FILL",
  "OPEN",
  "NOT_FILLED",
  "CLOSED_TP",
  "CLOSED_SL",
  "CLOSED_MANUAL",
  "LIQUIDATED",
  "ERROR",
];

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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CopyTradeStatus | "">("");
  const [includeDryRun, setIncludeDryRun] = useState(true);
  const { data, isLoading, error } = useCopyTrades(page, status, includeDryRun);

  if (isLoading && !data) return <div className="p-4 text-surface-400">{t("copy.common.loading")}</div>;
  if (error) return <div className="p-4 text-red-loss">{t("copy.common.errorPrefix")} {String(error)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <StatusFilter
          value={status}
          options={TRADE_STATUSES}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          labelKeyPrefix="copy.trades.status"
        />
        <label className="flex items-center gap-1 text-sm text-surface-400">
          <input
            type="checkbox"
            checked={includeDryRun}
            onChange={(e) => setIncludeDryRun(e.target.checked)}
          />
          {t("copy.trades.includeDryRun")}
        </label>
        <span className="ml-auto text-xs text-surface-500">{data.total} {t("copy.common.totalSuffix")}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm font-mono">
          <thead className="text-xs uppercase text-surface-400">
            <tr>
              <th className="px-2 py-2 text-left">{t("copy.trades.columns.created")}</th>
              <th className="px-2 py-2 text-left">{t("copy.trades.columns.status")}</th>
              <th className="px-2 py-2 text-left">{t("copy.trades.columns.direction")}</th>
              <th className="px-2 py-2 text-left">{t("copy.trades.columns.symbol")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.qty")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.margin")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.leverage")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.avgEntry")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.exit")}</th>
              <th className="px-2 py-2 text-right">{t("copy.trades.columns.pnl")}</th>
              <th className="px-2 py-2 text-left">{t("copy.trades.columns.dry")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((tr) => (
              <tr key={tr.id} className="border-t border-surface-800">
                <td className="px-2 py-1 whitespace-nowrap">{formatDateTime(tr.createdAt)}</td>
                <td className="px-2 py-1">{t(`copy.trades.status.${tr.status}`, { defaultValue: tr.status })}</td>
                <td className="px-2 py-1">{tr.direction}</td>
                <td className="px-2 py-1">{tr.symbol}</td>
                <td className="px-2 py-1 text-right">{tr.plannedQty}</td>
                <td className="px-2 py-1 text-right">{tr.plannedMargin}</td>
                <td className="px-2 py-1 text-right">{tr.leverageUsed}x</td>
                <td className="px-2 py-1 text-right">{tr.avgEntry ?? "—"}</td>
                <td className="px-2 py-1 text-right">{tr.exitPrice ?? "—"}</td>
                <td className={`px-2 py-1 text-right ${pnlTone(Number(tr.pnlUsdt ?? 0))}`}>
                  {tr.pnlUsdt ?? "—"}
                </td>
                <td className="px-2 py-1 text-amber-glow">{tr.dryRun ? t("copy.trades.dryBadge") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
