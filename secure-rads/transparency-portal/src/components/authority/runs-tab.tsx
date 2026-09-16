import { useMemo, useState } from "react";
import { type ColumnDef, type PaginationState, useTable } from "@tanstack/react-table";
import { SearchIcon } from "lucide-react";
import { DataTablePagination } from "@/components/data-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunEvent } from "@/lib/api";
import { formatDateTime, isFailureEvent, shortId } from "@/lib/format";
import { dataTableFeatures, type DataTableFeatures } from "@/lib/table-features";

const columns: ColumnDef<DataTableFeatures, RunEvent>[] = [
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
    accessorKey: "event",
    header: "Event",
    cell: ({ row }) => (
      <Badge variant={isFailureEvent(row.original.event) ? "destructive" : "secondary"}>{row.original.event}</Badge>
    ),
  },
  {
    accessorKey: "timestamp",
    header: "Timestamp",
    cell: ({ row }) => formatDateTime(row.original.timestamp),
  },
  {
    accessorKey: "detail",
    header: "Detail",
    cell: ({ row }) => (row.original.detail == null ? "" : JSON.stringify(row.original.detail)),
  },
];

const headClass = (id: string) => (id === "detail" ? "hidden lg:table-cell" : undefined);
const cellClass = (id: string) =>
  id === "detail" ? "hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell" : undefined;

export function RunsTab({ events }: { events: RunEvent[] }) {
  const [algorithm, setAlgorithm] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  const algorithms = [...new Set(events.map((event) => event.algorithmId))].sort();
  const needle = query.trim().toLowerCase();
  const data = useMemo(
    () =>
      events
        .filter((event) => (algorithm ? event.algorithmId === algorithm : true))
        .filter((event) => {
          if (!needle) return true;
          return (
            event.event.toLowerCase().includes(needle) ||
            event.runId.toLowerCase().includes(needle) ||
            event.algorithmId.toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [events, algorithm, needle],
  );

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  function selectAlgorithm(id: string | null) {
    setAlgorithm(id);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  function updateQuery(value: string) {
    setQuery(value);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run timelines</CardTitle>
        <CardDescription>Every run event across all algorithms, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={algorithm === null ? "default" : "outline"}
              size="sm"
              onClick={() => selectAlgorithm(null)}
            >
              All algorithms
            </Button>
            {algorithms.map((id) => (
              <Button
                key={id}
                variant={algorithm === id ? "default" : "outline"}
                size="sm"
                className="font-mono text-xs"
                title={id}
                onClick={() => selectAlgorithm(id)}
              >
                {shortId(id)}
              </Button>
            ))}
          </div>
          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by event, run, or algorithm"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary">{data.length.toLocaleString()} events</Badge>
        </div>

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={headClass(header.column.id)}>
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
                  No events.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className={cellClass(cell.column.id)}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <DataTablePagination table={table} label="Run events" />
      </CardContent>
    </Card>
  );
}
