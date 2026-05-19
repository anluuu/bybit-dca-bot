import { useTranslation } from "react-i18next";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (next: number) => void;
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center gap-2">
      <button
        className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page === 1}
      >
        {t("copy.common.prev")}
      </button>
      <span className="text-xs text-surface-500">
        {t("copy.common.pageOf", { page, total: totalPages })}
      </span>
      <button
        className="rounded bg-surface-800 px-3 py-1 text-sm disabled:opacity-40"
        onClick={() => onPage(page + 1)}
        disabled={page * pageSize >= total}
      >
        {t("copy.common.next")}
      </button>
    </div>
  );
}
