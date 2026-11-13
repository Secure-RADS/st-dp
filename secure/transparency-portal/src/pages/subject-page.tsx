import { SubjectLookup } from "@/components/subject-lookup";

export function SubjectPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-medium">Data subject</h1>
        <p className="text-sm text-muted-foreground">
          This shows usage metadata only - which algorithms and runs touched your identifier, never your personal
          data.
        </p>
      </div>
      <SubjectLookup />
    </div>
  );
}
