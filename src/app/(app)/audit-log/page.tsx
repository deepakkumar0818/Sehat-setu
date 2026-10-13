"use client";

import { useState } from "react";
import { ScrollTextIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { useAuditLog } from "@/hooks/use-audit";
import { useBranches } from "@/hooks/use-branches";
import type { UserRole } from "@/types";

const ROLES: UserRole[] = ["clinic_admin", "doctor", "receptionist", "nurse", "pharmacist", "lab_staff"];

export default function AuditLogPage() {
  const branches = useBranches();
  const [search, setSearch] = useState("");
  const [actorRole, setActorRole] = useState<UserRole | "all">("all");
  const [branchId, setBranchId] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLog({ search, actorRole, branchId, page, pageSize: 20 });

  return (
    <div className="space-y-5">
      <PageHeader title="Audit Log" description="A record of key actions taken across your clinic." />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by actor or action..." />
        <div className="flex gap-2">
          <Select value={actorRole} onValueChange={(v) => { setActorRole(v as UserRole | "all"); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title="No activity found" description="Try changing your filters." />
      ) : (
        <>
          <div className="divide-y overflow-hidden rounded-lg border">
            {data.items.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="text-foreground">
                    <span className="font-medium">{entry.actorName}</span> {entry.action.toLowerCase()}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(entry.date)}</p>
                </div>
                <Badge variant="outline" className="capitalize">{ROLE_LABELS[entry.actorRole]}</Badge>
              </div>
            ))}
          </div>
          <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>
        </>
      )}
    </div>
  );
}
