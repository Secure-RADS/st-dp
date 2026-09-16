import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { DataPagination } from "@/components/data-pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SubjectAccess } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";

export function AccessTab({ access }: { access: ReadonlyArray<SubjectAccess> }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = access
    .filter((row) => {
      if (!needle) return true;
      return (
        row.dataSubjectId.toLowerCase().includes(needle) ||
        row.algorithmId.toLowerCase().includes(needle) ||
        row.runId.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const pagination = usePagination(filtered);

  function updateQuery(value: string) {
    setQuery(value);
    pagination.setPage(1);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subject access events</CardTitle>
        <CardDescription>Every record access the PDM has served, newest first.</CardDescription>
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
          <Badge variant="secondary">{filtered.length.toLocaleString()} accesses</Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data subject</TableHead>
              <TableHead>Algorithm</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>Accessed at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.pageItems.map((row, index) => (
              <TableRow key={`${row.dataSubjectId}-${row.runId}-${row.timestamp}-${index}`}>
                <TableCell className="font-mono text-xs">{shortId(row.dataSubjectId, 20)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.algorithmId)}</TableCell>
                <TableCell className="font-mono text-xs">{shortId(row.runId)}</TableCell>
                <TableCell>{formatDateTime(row.timestamp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <DataPagination pagination={pagination} label="Subject access events" />
      </CardContent>
    </Card>
  );
}
