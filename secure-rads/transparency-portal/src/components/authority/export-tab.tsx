import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportJsonUrl, exportUrl, type RunEvent } from "@/lib/api";

export function ExportTab({ events }: { events: RunEvent[] }) {
  const algorithms = [...new Set(events.map((event) => event.algorithmId))].sort();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Export the full run log</CardTitle>
          <CardDescription>Every event across all algorithms, as CSV or JSON.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button render={<a href={exportUrl()} target="_blank" rel="noreferrer" />}>
            <DownloadIcon data-icon="inline-start" />
            CSV
          </Button>
          <Button variant="outline" render={<a href={exportJsonUrl()} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon data-icon="inline-start" />
            JSON
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export per algorithm</CardTitle>
          <CardDescription>One algorithm's timeline at a time.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {algorithms.map((id) => (
            <Button
              key={id}
              variant="outline"
              className="font-mono text-xs"
              render={<a href={exportUrl(id)} target="_blank" rel="noreferrer" />}
            >
              <DownloadIcon data-icon="inline-start" />
              {id}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
