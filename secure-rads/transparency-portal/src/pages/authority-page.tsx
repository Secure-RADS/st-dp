import { useCallback } from "react";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { AccessTab } from "@/components/authority/access-tab";
import { ExportTab } from "@/components/authority/export-tab";
import { OverviewTab } from "@/components/authority/overview-tab";
import { RunsTab } from "@/components/authority/runs-tab";
import { SubjectLookup } from "@/components/subject-lookup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAllSubjectAccess, getRunEvents } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

export function AuthorityPage() {
  const load = useCallback(async () => {
    const [events, accessResponse] = await Promise.all([getRunEvents(), getAllSubjectAccess()]);
    return { events, access: accessResponse.accesses };
  }, []);
  const { data, error, loading, reload } = useResource(load);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">Service authority</h1>
          <p className="text-sm text-muted-foreground">Full visibility across builds, runs, and subject access.</p>
        </div>
        <Button variant="outline" onClick={reload} disabled={loading}>
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load telemetry</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <Tabs defaultValue="overview">
          <TabsList className="!h-auto w-full flex-wrap justify-start">
            <TabsTrigger className="!h-auto" value="overview">Overview</TabsTrigger>
            <TabsTrigger className="!h-auto" value="runs">Runs</TabsTrigger>
            <TabsTrigger className="!h-auto" value="access">Access events</TabsTrigger>
            <TabsTrigger className="!h-auto" value="subject">Subject lookup</TabsTrigger>
            <TabsTrigger className="!h-auto" value="export">Export</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-2">
            <OverviewTab events={data.events} access={data.access} />
          </TabsContent>
          <TabsContent value="runs" className="pt-2">
            <RunsTab events={data.events} />
          </TabsContent>
          <TabsContent value="access" className="pt-2">
            <AccessTab access={data.access} />
          </TabsContent>
          <TabsContent value="subject" className="pt-2">
            <SubjectLookup />
          </TabsContent>
          <TabsContent value="export" className="pt-2">
            <ExportTab events={data.events} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
