"use client";

import { Building2Icon, StethoscopeIcon, UsersIcon, UserRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { StatCard } from "@/components/shared/stat-card";
import { useClinicProfile } from "@/hooks/use-clinic-admin";
import type { ClinicProfile } from "@/lib/live-types";

// Plan & usage in the live staff app. Sehat Setu has no in-app subscription
// billing yet, so this shows the clinic's account status and real usage from
// the clinic database, and no plans, prices or invoices that don't exist.

const STATUS: Record<ClinicProfile["status"], { label: string; className: string; note: string }> = {
  active: { label: "Active", className: "border-success/30 text-success", note: "Your clinic account is active. All features are available." },
  pending: { label: "Pending", className: "border-warning/30 text-warning", note: "Your clinic account is waiting for activation by Sehat Setu." },
  suspended: { label: "Suspended", className: "border-destructive/30 text-destructive", note: "Your clinic account is suspended. Contact Sehat Setu support." },
};

export function LiveSubscription() {
  const query = useClinicProfile();
  const clinic = query.data;
  const status = clinic ? STATUS[clinic.status] : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Subscription" description="Your Sehat Setu account status and usage." />

      {query.error ? (
        <QueryError error={query.error} what="Account details" onRetry={() => query.refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {clinic?.name ?? "Your clinic"}
                {status && <Badge variant="outline" className={status.className}>{status.label}</Badge>}
              </CardTitle>
              <CardDescription>{status?.note ?? "Loading…"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Plan:</span> not set up. Sehat Setu doesn&apos;t bill clinics through the app yet, so there are no plan
                limits, charges or invoices here. Your usage is shown below.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Branches" value={clinic ? `${clinic.usage.activeBranches} active${clinic.usage.branches > clinic.usage.activeBranches ? ` / ${clinic.usage.branches}` : ""}` : "—"} icon={Building2Icon} isLoading={query.isLoading} />
            <StatCard label="Staff accounts" value={clinic ? String(clinic.usage.staff) : "—"} icon={UsersIcon} isLoading={query.isLoading} />
            <StatCard label="Doctors" value={clinic ? String(clinic.usage.doctors) : "—"} icon={StethoscopeIcon} isLoading={query.isLoading} />
            <StatCard label="Patients" value={clinic ? String(clinic.usage.patients) : "—"} icon={UserRoundIcon} isLoading={query.isLoading} />
          </div>
        </>
      )}
    </div>
  );
}
