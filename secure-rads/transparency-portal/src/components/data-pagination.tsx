import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAGE_SIZES, type PageSize, type Pagination } from "@/lib/use-pagination";

interface DataPaginationProps<T> {
  pagination: Pagination<T>;
  label: string;
}

export function DataPagination<T>({ pagination, label }: DataPaginationProps<T>) {
  const { page, pageCount, pageSize, total, start, end, setPage, setPageSize } = pagination;

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {total === 0 ? "No rows" : `${(start + 1).toLocaleString()}-${end.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value) as PageSize)}>
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeftIcon data-icon="inline-start" />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            Next
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
