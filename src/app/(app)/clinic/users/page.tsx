"use client";

import { useState } from "react";
import { PlusIcon, SearchXIcon, UserRoundCogIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { DoctorFormDialog } from "@/components/doctors/doctor-form-dialog";
import { useClinicUsers } from "@/hooks/use-clinic-users";
import { useCurrentClinicId } from "@/hooks/use-current-clinic-id";
import { useBranchesForClinic } from "@/hooks/use-tenant-branches";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import type { UserRole } from "@/types";

export default function ClinicUsersPage() {
  const clinicId = useCurrentClinicId();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRole | "all">("all");
  const [branchId, setBranchId] = useState<string | "all">("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState<"staff" | "doctor" | null>(null);

  const { data: branches = [] } = useBranchesForClinic(clinicId);
  const { data, isLoading } = useClinicUsers({ clinicId: clinicId ?? "", search, role, branchId, page, pageSize: 15 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users & Roles"
        description="Everyone with access to this clinic — staff and doctors together."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button><PlusIcon /> Add Staff</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAddOpen("doctor")}>Add a doctor</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddOpen("staff")}>Add other staff</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name, email, or phone..." className="sm:w-72" />
        <Select value={role} onValueChange={(v) => { setRole(v as UserRole | "all"); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {(Object.keys(ROLE_LABELS) as UserRole[]).filter((r) => r !== "patient").map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={SearchXIcon} title="No users found" description="Try a different search or filter." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
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
              {data.items.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar name={row.name} color={row.avatarColor} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{row.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{ROLE_LABELS[row.role]}</Badge>
                    {row.specialtyName && <p className="mt-1 text-xs text-muted-foreground">{row.specialtyName}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.departmentName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.branchName}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(row.joinedDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </div>
      )}

      {!clinicId && (
        <EmptyState icon={UserRoundCogIcon} title="No clinic context" description="Sign in with a clinic account to manage users." />
      )}

      <StaffFormDialog open={addOpen === "staff"} onOpenChange={(open) => setAddOpen(open ? "staff" : null)} />
      <DoctorFormDialog open={addOpen === "doctor"} onOpenChange={(open) => setAddOpen(open ? "doctor" : null)} />
    </div>
  );
}
