import { useMemo, useState } from "react";
import { type ColumnDef, type PaginationState, useTable } from "@tanstack/react-table";
import { SearchIcon } from "lucide-react";
import { DataTablePagination } from "@/components/data-pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SubjectAccess } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { dataTableFeatures, type DataTableFeatures } from "@/lib/table-features";

const columns: ColumnDef<DataTableFeatures, SubjectAccess>[] = [
  {
    accessorKey: "dataSubjectId",
    header: "Data subject",
    cell: ({ row }) => (
      <span className="font-mono text-xs" title={row.original.dataSubjectId}>
        {shortId(row.original.dataSubjectId, 20)}
      </span>
    ),
  },
  {
    accessorKey: "algorithmId",
    header: "Algorithm",
    cell: ({ row }) => (
      <span className="font-mono text-xs" title={row.original.algorithmId}>
        {shortId(row.original.algorithmId)}
      </span>
    ),
  },
  {
    accessorKey: "runId",
    header: "Run",
    cell: ({ row }) => (
      <span className="font-mono text-xs" title={row.original.runId}>
        {shortId(row.original.runId)}
      </span>
    ),
  },
  {
    accessorKey: "timestamp",
    header: "Accessed at",
    cell: ({ row }) => formatDateTime(row.original.timestamp),
  },
];

export function AccessTab({ access, truncated }: { access: SubjectAccess[]; truncated?: boolean }) {
  const [query, setQuery] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  const needle = query.trim().toLowerCase();
  const data = useMemo(
    () =>
      access
        .filter((row) => {
          if (!needle) return true;
          return (
            row.dataSubjectId.toLowerCase().includes(needle) ||
            row.algorithmId.toLowerCase().includes(needle) ||
            row.runId.toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [access, needle],
  );

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  function updateQuery(value: string) {
    setQuery(value);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subject access events</CardTitle>
        <CardDescription>
          {truncated
            ? `Showing the first ${access.length.toLocaleString()} access events from a larger table.`
            : "Every record access the PDM has served, newest first."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter by subject, algorithm, or run"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary">{data.length.toLocaleString()} accesses</Badge>
        </div>

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No accesses.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <DataTablePagination table={table} label="Subject access events" />
      </CardContent>
    </Card>
  );
}
