export const MAX_PAGE_SIZE = 200;

export function normalizePage(
  page: number,
  pageSize: number
): { page: number; pageSize: number; offset: number } {
  const p = Math.max(1, Number.isFinite(page) ? page : 1);
  const ps = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(pageSize) ? pageSize : 50));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}
