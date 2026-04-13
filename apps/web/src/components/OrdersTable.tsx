import { ArrowUpDown, ChevronLeft, ChevronRight, ListOrdered } from "lucide-react";
import { useState } from "react";
import type { Order } from "../lib/api.ts";

interface OrdersTableProps {
  orders: Order[];
  page?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

type SortKey = "executedAt" | "fiatSpent" | "price";

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    filled: "bg-green-gain/10 text-green-gain border-green-gain/20",
    failed: "bg-red-loss/10 text-red-loss border-red-loss/20",
    skipped_cap: "bg-amber-glow/10 text-amber-glow border-amber-glow/20",
    cancelled: "bg-surface-500/10 text-surface-400 border-surface-500/20",
    pending: "bg-violet-tech/10 text-violet-tech border-violet-tech/20",
  };

  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 font-mono text-xs ${styles[status] ?? styles.cancelled}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function OrdersTable({
  orders,
  page,
  totalPages,
  total,
  onPageChange,
}: OrdersTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("executedAt");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...orders].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "executedAt") {
      cmp =
        new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime();
    } else if (sortKey === "fiatSpent") {
      cmp = (parseFloat(a.fiatSpent ?? "0")) - (parseFloat(b.fiatSpent ?? "0"));
    } else if (sortKey === "price") {
      cmp = (parseFloat(a.price ?? "0")) - (parseFloat(b.price ?? "0"));
    }
    return sortAsc ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-surface-700/30 px-5 py-4">
        <ListOrdered className="h-4 w-4 text-amber-glow" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
          Purchase History
        </h2>
        <span className="ml-auto font-mono text-xs text-surface-400">
          {total !== undefined ? `${total} orders` : `${orders.length} orders`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead>
            <tr className="border-b border-surface-700/20 text-xs uppercase tracking-wider text-surface-400">
              <th className="px-5 py-3">
                <SortButton
                  label="Date"
                  active={sortKey === "executedAt"}
                  asc={sortAsc}
                  onClick={() => toggleSort("executedAt")}
                />
              </th>
              <th className="px-3 py-3">Pair</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">
                <SortButton
                  label="Price"
                  active={sortKey === "price"}
                  asc={sortAsc}
                  onClick={() => toggleSort("price")}
                />
              </th>
              <th className="px-3 py-3">BTC Amount</th>
              <th className="px-3 py-3">
                <SortButton
                  label="Spent"
                  active={sortKey === "fiatSpent"}
                  asc={sortAsc}
                  onClick={() => toggleSort("fiatSpent")}
                />
              </th>
              <th className="px-3 py-3">Fee</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr
                key={order.id}
                className="border-b border-surface-700/10 transition-colors hover:bg-surface-800/40"
              >
                <td className="px-5 py-3 font-mono text-xs text-surface-200">
                  {formatDate(order.executedAt)}
                </td>
                <td className="px-3 py-3 font-mono text-xs font-medium text-surface-100">
                  {order.pair}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`font-mono text-xs ${order.orderType === "limit" ? "text-violet-tech" : "text-amber-glow"}`}
                  >
                    {order.orderType}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs tabular-nums text-surface-200">
                  {order.price
                    ? `R$${parseFloat(order.price).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
                    : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-xs tabular-nums text-amber-glow">
                  {order.quantity
                    ? parseFloat(order.quantity).toFixed(8)
                    : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-xs tabular-nums text-surface-200">
                  {order.fiatSpent
                    ? `R$${parseFloat(order.fiatSpent).toFixed(2)}`
                    : "—"}
                </td>
                <td className="px-3 py-3 font-mono text-xs tabular-nums text-surface-400">
                  {order.fee
                    ? `${parseFloat(order.fee).toFixed(8)} ${order.feeCurrency}`
                    : "—"}
                </td>
                <td className="px-3 py-3">{statusBadge(order.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page !== undefined && totalPages !== undefined && totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-surface-700/30 px-5 py-3">
          <span className="font-mono text-xs text-surface-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-surface-700/40 bg-surface-800/40 px-2.5 py-1.5 text-xs text-surface-300 transition-colors hover:border-amber-glow/40 hover:text-amber-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-700/40 disabled:hover:text-surface-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-surface-700/40 bg-surface-800/40 px-2.5 py-1.5 text-xs text-surface-300 transition-colors hover:border-amber-glow/40 hover:text-amber-glow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-700/40 disabled:hover:text-surface-300"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortButton({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 hover:text-surface-200 transition-colors"
    >
      {label}
      <ArrowUpDown
        className={`h-3 w-3 ${active ? "text-amber-glow" : "text-surface-500"} ${active && asc ? "rotate-180" : ""} transition-transform`}
      />
    </button>
  );
}
