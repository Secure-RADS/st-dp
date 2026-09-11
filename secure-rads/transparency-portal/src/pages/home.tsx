import { Link } from "react-router-dom";
import { ArrowRightIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-medium">Secure RADS transparency</h1>
        <p className="max-w-2xl text-muted-foreground">
          Two views over the same audited workflow: data subjects can see where their records were used, and the
          service authority can inspect every build, run, and access event.
        </p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRoundIcon className="size-5" />
              Data subject
            </CardTitle>
            <CardDescription>Look up which algorithms and runs used your records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/subject" />}>
              Open lookup
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5" />
              Service authority
            </CardTitle>
            <CardDescription>Full run timelines, access events, failures, and exports.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link to="/authority" />}>
              Open dashboard
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
