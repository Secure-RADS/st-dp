import { useState } from "react";

export const PAGE_SIZES = [25, 50, 100, 250] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface Pagination<T> {
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  start: number;
  end: number;
  pageItems: T[];
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
}

// Client-side pagination over an already-loaded list. Callers reset to page 1 when their filters change.
export function usePagination<T>(items: T[], initialSize: PageSize = 50): Pagination<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(initialSize);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  return {
    page: current,
    pageCount,
    pageSize,
    total: items.length,
    start,
    end,
    pageItems: items.slice(start, start + pageSize),
    setPage,
    setPageSize,
  };
}
