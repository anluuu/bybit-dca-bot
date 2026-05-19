import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CopySignalsPage, CopySignalStatus } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { Pagination } from "./Pagination.tsx";
import { StatusFilter } from "./StatusFilter.tsx";

const SIGNAL_STATUSES: readonly CopySignalStatus[] = [
  "PARSED",
  "UNPARSEABLE",
  "SKIPPED",
  "EXECUTED",
];

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
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<CopySignalStatus | "">("");
  const { data, isLoading, error } = useCopySignals(page, status || undefined);

  if (isLoading && !data) return <div className="p-4 text-gray-500">{t("copy.common.loading")}</div>;
  if (error) return <div className="p-4 text-red-500">{t("copy.common.errorPrefix")} {String(error)}</div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusFilter
          value={status}
          options={SIGNAL_STATUSES}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          labelKeyPrefix="copy.signals.status"
        />
        <span className="text-xs text-gray-500">{data.total} {t("copy.common.totalSuffix")}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm font-mono">
          <thead className="text-xs uppercase text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">{t("copy.signals.columns.received")}</th>
              <th className="px-2 py-2 text-left">{t("copy.signals.columns.status")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.sender")}</th>
              <th className="px-2 py-2 text-left">{t("copy.signals.columns.direction")}</th>
              <th className="px-2 py-2 text-left">{t("copy.signals.columns.symbol")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.entryLow")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.entryHigh")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.stopLoss")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.leverage")}</th>
              <th className="px-2 py-2 text-right">{t("copy.signals.columns.tp1")}</th>
              <th className="px-2 py-2 text-left">{t("copy.signals.columns.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id} className="border-t border-surface-700/10">
                <td className="px-2 py-1 whitespace-nowrap">{formatDateTime(s.receivedAt)}</td>
                <td className="px-2 py-1">{t(`copy.signals.status.${s.status}`, { defaultValue: s.status })}</td>
                <td className="px-2 py-1 text-right whitespace-nowrap">{s.telegramSenderId ?? "—"}</td>
                <td className="px-2 py-1">{s.direction ?? "—"}</td>
                <td className="px-2 py-1">{s.symbol ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.entryLow ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.entryHigh ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.stopLoss ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.leverageRaw ?? "—"}</td>
                <td className="px-2 py-1 text-right">{s.takeProfit1 ?? "—"}</td>
                <td className="px-2 py-1 text-left text-amber-glow">{s.skipReason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
