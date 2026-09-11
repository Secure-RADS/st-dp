import { ActivityIcon, DatabaseIcon, FileWarningIcon, LayersIcon, UserRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunEvent, SubjectAccess } from "@/lib/api";
import { formatDateTime, isFailureEvent } from "@/lib/format";

interface OverviewTabProps {
  events: RunEvent[];
  access: SubjectAccess[];
}

export function OverviewTab({ events, access }: OverviewTabProps) {
  const algorithms = new Set(events.map((event) => event.algorithmId));
  const runs = new Set(events.map((event) => event.runId));
  const failures = events
    .filter((event) => isFailureEvent(event.event))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const stats = [
    { label: "Algorithms", value: algorithms.size, icon: LayersIcon },
    { label: "Runs", value: runs.size, icon: ActivityIcon },
    { label: "Events", value: events.length, icon: DatabaseIcon },
    { label: "Subject accesses", value: access.length, icon: UserRoundIcon },
    { label: "Failed events", value: failures.length, icon: FileWarningIcon },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <stat.icon className="size-4" />
                {stat.label}
              </CardDescription>
              <CardTitle className="text-2xl">{stat.value.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent failures</CardTitle>
          <CardDescription>Build, launch, and run failures across all algorithms.</CardDescription>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed events recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Algorithm</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.slice(0, 10).map((failure, index) => (
                  <TableRow key={`${failure.runId}-${failure.timestamp}-${index}`}>
                    <TableCell className="font-mono text-xs">{failure.algorithmId}</TableCell>
                    <TableCell className="font-mono text-xs">{failure.runId}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{failure.event}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(failure.timestamp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
