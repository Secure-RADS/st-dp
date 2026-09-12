import { useState } from "react";
import { SearchIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSubjectAccess, type SubjectAccessResponse } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";

export function SubjectLookup() {
  const [dataSubjectId, setDataSubjectId] = useState("");
  const [result, setResult] = useState<SubjectAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    const id = dataSubjectId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await getSubjectAccess(id));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const accesses = [...(result?.accesses ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data subject access request</CardTitle>
        <CardDescription>
          Enter your data subject identifier to see which algorithms and runs used your records.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="data-subject-id">Data subject identifier</Label>
            <Input
              id="data-subject-id"
              placeholder="00000000-0000-5000-8000-000000000000"
              value={dataSubjectId}
              onChange={(event) => setDataSubjectId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void lookup();
              }}
            />
          </div>
          <Button disabled={loading || dataSubjectId.trim().length === 0} onClick={() => void lookup()}>
            <SearchIcon data-icon="inline-start" />
            Look up
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Lookup failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result && !loading && accesses.length > 0 ? (
          <div className="flex flex-col gap-3">
            <Badge variant="secondary">{accesses.length} recorded uses</Badge>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Algorithm</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Used at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accesses.map((access, index) => (
                  <TableRow key={`${access.runId}-${access.timestamp}-${index}`}>
                    <TableCell className="font-mono text-xs" title={access.algorithmId}>{shortId(access.algorithmId)}</TableCell>
                    <TableCell className="font-mono text-xs" title={access.runId}>{shortId(access.runId)}</TableCell>
                    <TableCell>{formatDateTime(access.timestamp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {result && !loading && accesses.length === 0 ? (
          <Alert>
            <AlertTitle>No recorded uses</AlertTitle>
            <AlertDescription>
              No algorithm has accessed records for this identifier. Check the identifier or try again later.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
