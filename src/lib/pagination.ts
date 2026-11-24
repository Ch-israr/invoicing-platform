/** List pagination helpers. Page numbers come from URL search params. */
export const PAGE_SIZE = 20;

export function parsePage(value: string | string[] | undefined): number {
  const n = typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function pageCount(total: number, perPage: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / perPage));
}
