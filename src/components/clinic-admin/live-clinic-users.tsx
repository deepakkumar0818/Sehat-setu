"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { useLiveBranchList, useLiveClinicUsers } from "@/hooks/use-clinic-admin";
import { MemberAccessDialog } from "@/components/clinic-admin/member-access-dialog";
import type { LiveClinicUser } from "@/lib/live-types";
import { ROLE_KEY_TO_USER_ROLE } from "@/lib/auth/session-user";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Users & Roles (clinic database): everyone with a staff role here — doctors and
// other staff together. Same layout as the demo page. Administrators click a
// person to change their role and permissions; people are invited on Staff.

const PAGE_SIZE = 15;
const STAFF_ROLES = Object.entries(ROLE_KEY_TO_USER_ROLE).filter(([key]) => key !== "PATIENT").map(([, role]) => role as UserRole);
const CLINIC_WIDE = "clinic";

export function LiveClinicUsers() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRole | "all">("all");
  const [branchId, setBranchId] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LiveClinicUser | null>(null);
  const query = useLiveClinicUsers();
  const branches = useLiveBranchList().data ?? [];

  const q = search.trim().toLowerCase();
  const rows = (query.data?.items ?? []).filter(
    (u) =>
      (!q || [u.name, u.email, u.specialtyName ?? ""].some((v) => v.toLowerCase().includes(q))) &&
      (role === "all" || u.role === role) &&
      (branchId === "all" || (branchId === CLINIC_WIDE ? u.branchId === null : u.branchId === branchId))
  );
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users & Roles"
        description={query.data?.canManage ? "Everyone with access to this clinic. Click a person to change their role or permissions." : "Everyone with access to this clinic — staff and doctors together."}
        actions={<Button asChild><Link href="/staff"><PlusIcon /> Add Staff</Link></Button>}
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name or email..." className="sm:w-72" />
        <Select value={role} onValueChange={(v) => { setRole(v as UserRole | "all"); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Role"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Branch"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            <SelectItem value={CLINIC_WIDE}>Clinic-wide</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Users" onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={SearchXIcon} title="No users found" description={q || role !== "all" || branchId !== "all" ? "Try a different search or filter." : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium">Branch</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((u) => (
                  <tr
                    key={u.membershipId}
                    className={u.canEditPermissions ? "cursor-pointer hover:bg-muted/30" : "hover:bg-muted/30"}
                    onClick={u.canEditPermissions ? () => setEditing(u) : undefined}
                    onKeyDown={u.canEditPermissions ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(u); } } : undefined}
                    tabIndex={u.canEditPermissions ? 0 : undefined}
                    aria-label={u.canEditPermissions ? `Change ${u.name}'s role or permissions` : undefined}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <PersonAvatar name={u.name} color="#64748b" size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{u.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
                      {u.granted.length + u.revoked.length > 0 && <Badge variant="secondary" className="ml-1">Custom</Badge>}
                      {u.specialtyName && <p className="mt-1 text-xs text-muted-foreground">{u.specialtyName}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.departmentName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.branchName ?? "All branches"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatDate(u.joinedDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DataTablePagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
        </div>
      )}

      {editing && query.data && <MemberAccessDialog key={editing.membershipId} user={editing} page={query.data} onClose={() => setEditing(null)} />}
    </div>
  );
}
