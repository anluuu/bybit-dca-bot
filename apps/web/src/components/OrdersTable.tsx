import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListOrdered,
  PackageOpen,
} from "lucide-react";
import { useState } from "react";
import type { Order, PublicOrder } from "../lib/api.ts";
import { nextSundayLabel } from "../lib/nextBuy.ts";

/**
 * Display shape shared by admin `Order` and sanitized `PublicOrder`.
 * Fields missing in PublicOrder (`id`, `isTest`) are optional here so both
 * types are assignable.
 */
type OrderRow = {
  id?: number;
  executedAt: string;
  pair: string;
  orderType: string;
  status: string;
  price: string | null;
  quantity: string | null;
  fiatSpent: string | null;
  fee: string | null;
  feeCurrency: string | null;
  isTest?: boolean;
};

interface OrdersTableProps {
  orders: ReadonlyArray<Order | PublicOrder>;
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

  const rows: OrderRow[] = orders as unknown as OrderRow[];

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-surface-700/30 px-5 py-4">
          <ListOrdered className="h-4 w-4 text-amber-glow" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-surface-300">
            Purchase History
          </h2>
          <span className="ml-auto font-mono text-xs text-surface-400">
            0 orders
          </span>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-14">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-glow/20 bg-amber-glow/5">
            <PackageOpen className="h-5 w-5 text-amber-glow" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-surface-200">
              Waiting for the first fill
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5 font-mono text-xs text-surface-400">
              <Clock className="h-3 w-3" />
              {nextSundayLabel()}
            </p>
          </div>
          {/* Skeleton rows — hint at the table that will live here */}
          <div className="mt-3 w-full max-w-md space-y-2 opacity-40">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-surface-700/30 bg-surface-800/20 px-3 py-2"
              >
                <div className="h-2 w-20 rounded bg-surface-700/40" />
                <div className="h-2 w-16 rounded bg-surface-700/40" />
                <div className="ml-auto h-2 w-14 rounded bg-amber-glow/20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
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
          {total !== undefined ? `${total} orders` : `${rows.length} orders`}
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
            {sorted.map((order, idx) => (
              <tr
                key={order.id ?? `${order.executedAt}-${order.pair}-${idx}`}
                className="border-b border-surface-700/10 transition-colors hover:bg-surface-800/40"
              >
                <td className="px-5 py-3 font-mono text-xs text-surface-200">
                  {formatDate(order.executedAt)}
                </td>
                <td className="px-3 py-3 font-mono text-xs font-medium text-surface-100">
                  <span className="inline-flex items-center gap-1.5">
                    {order.pair}
                    {order.isTest && (
                      <span className="rounded border border-violet-tech/30 bg-violet-tech/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violet-tech">
                        test
                      </span>
                    )}
                  </span>
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
                    ? order.feeCurrency
                      ? `${parseFloat(order.fee).toFixed(8)} ${order.feeCurrency}`
                      : parseFloat(order.fee).toFixed(8)
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
