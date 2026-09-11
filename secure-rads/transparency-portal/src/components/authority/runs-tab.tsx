import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunEvent } from "@/lib/api";
import { formatDateTime, isFailureEvent, shortId } from "@/lib/format";

const MAX_ROWS = 500;

export function RunsTab({ events }: { events: RunEvent[] }) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run timelines</CardTitle>
        <CardDescription>Every run event across all algorithms, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={algorithm === null ? "default" : "outline"} size="sm" onClick={() => setAlgorithm(null)}>
              All algorithms
            </Button>
            {algorithms.map((id) => (
              <Button
                key={id}
                variant={algorithm === id ? "default" : "outline"}
                size="sm"
                className="font-mono text-xs"
                onClick={() => setAlgorithm(id)}
              >
                {id}
              </Button>
            ))}
          </div>
          <div className="relative max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Filter by event, run, or algorithm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary">{filtered.length.toLocaleString()} events</Badge>
          {filtered.length > MAX_ROWS ? <Badge variant="outline">showing first {MAX_ROWS}</Badge> : null}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Algorithm</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, MAX_ROWS).map((event, index) => (
              <TableRow key={`${event.runId}-${event.timestamp}-${index}`}>
                <TableCell className="font-mono text-xs">{shortId(event.algorithmId)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(event.runId)}</TableCell>
                <TableCell>
                  <Badge variant={isFailureEvent(event.event) ? "destructive" : "secondary"}>{event.event}</Badge>
                </TableCell>
                <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                  {event.detail == null ? "" : JSON.stringify(event.detail)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
