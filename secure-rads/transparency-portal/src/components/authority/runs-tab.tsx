import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { DataPagination } from "@/components/data-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunEvent } from "@/lib/api";
import { formatDateTime, isFailureEvent, shortId } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";

export function RunsTab({ events }: { events: ReadonlyArray<RunEvent> }) {
  const [algorithm, setAlgorithm] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const algorithms = [...new Set(events.map((event) => event.algorithmId))].sort();
  const needle = query.trim().toLowerCase();
  const filtered = events
    .filter((event) => (algorithm ? event.algorithmId === algorithm : true))
    .filter((event) => {
      if (!needle) return true;
      return (
        event.event.toLowerCase().includes(needle) ||
        event.runId.toLowerCase().includes(needle) ||
        event.algorithmId.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const pagination = usePagination(filtered);

  function selectAlgorithm(id: string | null) {
    setAlgorithm(id);
    pagination.setPage(1);
  }

  function updateQuery(value: string) {
    setQuery(value);
    pagination.setPage(1);
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
          <Badge variant="secondary">{filtered.length.toLocaleString()} events</Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Algorithm</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead className="hidden lg:table-cell">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((event, index) => (
              <TableRow key={`${event.runId}-${event.timestamp}-${index}`}>
                <TableCell className="font-mono text-xs" title={event.algorithmId}>{shortId(event.algorithmId)}</TableCell>
                <TableCell className="font-mono text-xs" title={event.runId}>{shortId(event.runId)}</TableCell>
                <TableCell>
                  <Badge variant={isFailureEvent(event.event) ? "destructive" : "secondary"}>{event.event}</Badge>
                </TableCell>
                <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell">
                  {event.detail == null ? "" : JSON.stringify(event.detail)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <DataPagination pagination={pagination} label="Run events" />
      </CardContent>
    </Card>
  );
}
