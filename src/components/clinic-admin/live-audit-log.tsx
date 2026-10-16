"use client";

import { useState } from "react";
import { ScrollTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { useLiveAuditLog } from "@/hooks/use-clinic-admin";
import { formatDateTime } from "@/lib/format";
import type { AuditArea, AuditEntry } from "@/lib/live-types";
import { cn } from "@/lib/utils";

// The clinic's audit log (clinic database): who did what and when. Entries name
// the changed fields but never their values.

const AREAS: { value: AuditArea; label: string }[] = [
  { value: "sign_in", label: "Sign-ins" },
  { value: "access", label: "Access denied" },
  { value: "patients", label: "Patients" },
  { value: "appointments", label: "Appointments" },
  { value: "clinical", label: "Clinical records" },
  { value: "billing", label: "Billing & expenses" },
  { value: "inventory", label: "Inventory" },
  { value: "staff", label: "Staff & roles" },
  { value: "setup", label: "Clinic setup" },
];
const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.value, a.label])) as Record<AuditArea, string>;

const OUTCOME_STYLE: Record<AuditEntry["outcome"], string> = {
  success: "border-success/30 text-success",
  denied: "border-warning/30 text-warning",
  failure: "border-destructive/30 text-destructive",
};

/** "changed name, phone" — field names in plain words. */
const fieldList = (changed: string[]) => changed.map((c) => c.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Id$/, "").toLowerCase()).join(", ");

export function LiveAuditLog() {
  const [search, setSearch] = useState("");
  const [area, setArea] = useState<AuditArea | "all">("all");
  const [outcome, setOutcome] = useState<AuditEntry["outcome"] | "all">("all");
  const [page, setPage] = useState(1);
  const query = useLiveAuditLog({
    search: search.trim() || undefined,
    area: area === "all" ? undefined : area,
    outcome: outcome === "all" ? undefined : outcome,
    page,
    pageSize: 25,
  });
  const data = query.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Audit Log" description="A record of sign-ins and changes across your clinic. Shows which fields changed, never their contents." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by person or action..." />
        <div className="flex gap-2">
          <Select value={area} onValueChange={(v) => { setArea(v as AuditArea | "all"); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Area"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              {AREAS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={(v) => { setOutcome(v as AuditEntry["outcome"] | "all"); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36" aria-label="Outcome"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any outcome</SelectItem>
              <SelectItem value="success">Succeeded</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="failure">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Audit records" onRetry={() => query.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title="No activity found" description={search || area !== "all" || outcome !== "all" ? "Try changing your filters." : "Sign-ins and changes will appear here."} />
      ) : (
        <>
          <ul className={cn("divide-y overflow-hidden rounded-lg border", query.isPlaceholderData && "opacity-60")}>
            {data.items.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3" data-testid="audit-entry">
                <div className="min-w-0">
                  <p className="text-foreground">
                    <span className="font-medium">{e.actorName}</span> · {e.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.occurredAt)}
                    {e.changed.length > 0 && ` · changed ${fieldList(e.changed)}`}
                    {e.reason && e.outcome !== "success" && ` · ${e.reason.replace(/_/g, " ").toLowerCase()}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Badge variant="outline">{AREA_LABEL[e.area] ?? "Other"}</Badge>
                  {e.outcome !== "success" && <Badge variant="outline" className={OUTCOME_STYLE[e.outcome]}>{e.outcome === "denied" ? "Denied" : "Failed"}</Badge>}
                </div>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>
        </>
      )}
    </div>
  );
}
