"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ContactIcon, MailPlusIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { PermissionMatrix } from "@/components/staff/permission-matrix";
import { StaffFormDialog } from "@/components/staff/staff-form-dialog";
import { InviteStaffDialog } from "@/components/staff/invite-staff-dialog";
import { EditPhoneDialog } from "@/components/staff/edit-phone-dialog";
import { InvitationsPanel } from "@/components/staff/invitations-panel";
import { INVITATIONS_NOT_READY } from "@/components/staff/invitation-labels";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatRelativeTime } from "@/lib/format";
import { useStaff, useUpdateStaffStatus } from "@/hooks/use-people";
import { useBranches } from "@/hooks/use-branches";
import type { StaffMember, StaffRole } from "@/types";
import type { StaffCapabilities } from "@/lib/live-types";
import { useLiveData } from "@/lib/data-source";
import { formatPhone } from "@/lib/phone";

/** Demo-mode role filter (fictional in-browser staff). */
const DEMO_ROLES: StaffRole[] = ["clinic_admin", "receptionist", "nurse", "pharmacist", "lab_staff"];
/** The staff roles that exist in the clinic database. */
const LIVE_ROLES: StaffRole[] = ["clinic_admin", "branch_manager", "receptionist", "nurse"];

export default function StaffPage() {
  return (
    <Suspense>
      <StaffPageContent />
    </Suspense>
  );
}

function StaffPageContent() {
  const live = useLiveData();
  const branches = useBranches();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") === "invitations" ? "invitations" : "directory");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<StaffRole | "all">("all");
  const [branchId, setBranchId] = useState("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [matrixRole, setMatrixRole] = useState<StaffRole>("receptionist");

  const { data, isLoading, isError, error, refetch } = useStaff({ search, role, branchId, page, pageSize: 10 });
  const updateStatus = useUpdateStaffStatus();
  const [editingPhone, setEditingPhone] = useState<StaffMember | null>(null);
  const capabilities: StaffCapabilities | undefined = live && data && "capabilities" in data ? (data.capabilities as StaffCapabilities) : undefined;
  const roles = live ? LIVE_ROLES : DEMO_ROLES;
  const filtered = search !== "" || role !== "all" || branchId !== "all";

  const columns: DataTableColumn<StaffMember>[] = [
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={s.name} color={s.avatarColor} size="sm" />
          <div className="min-w-0">
            <span className="font-medium text-foreground">{s.name}</span>
            {live && <p className="truncate text-xs text-muted-foreground">{s.email}</p>}
          </div>
        </div>
      ),
    },
    { key: "role", header: "Role", render: (s) => ROLE_LABELS[s.role] },
    { key: "branch", header: "Branch", render: (s) => branches.find((b) => b.id === s.branchId)?.name ?? (live && !s.branchId ? "All branches" : "—") },
    { key: "phone", header: "Phone", render: (s) => formatPhone(s.phone) || "—" },
    // Last activity isn't recorded in the clinic database, so the column is demo-only.
    ...(live ? [] : [{ key: "lastActive", header: "Last Active", render: (s: StaffMember) => (s.lastActiveAt ? formatRelativeTime(s.lastActiveAt) : "—") }]),
    { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <div className="flex items-center justify-end gap-2">
          {/* Live, Administrators: the server decides (and re-checks) who may edit a phone. */}
          {live && s.canEditPhone && (
            <Button variant="ghost" size="icon" aria-label={`Edit phone number for ${s.name}`} title="Edit phone number" onClick={() => setEditingPhone(s)}>
              <PencilIcon />
            </Button>
          )}
          {/* Live: only when the server says this user may change this membership (never their own). */}
          {(live ? s.canChangeStatus : true) && (
            <Switch
              aria-label={`${s.status === "active" ? "Deactivate" : "Activate"} ${s.name}`}
              checked={s.status === "active"}
              disabled={updateStatus.isPending}
              onCheckedChange={(checked) => updateStatus.mutate({ id: s.id, status: checked ? "active" : "inactive" })}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        description={live ? "Your clinic's team, and invitations to join it." : "Manage your team, roles, and permissions."}
        actions={
          live ? (
            capabilities?.canInvite ? (
              capabilities.invitationsReady ? (
                <Button onClick={() => setInviteOpen(true)}><MailPlusIcon /> Invite staff</Button>
              ) : (
                <Button disabled title={INVITATIONS_NOT_READY}><MailPlusIcon /> Invite staff (not set up yet)</Button>
              )
            ) : undefined
          ) : (
            <Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Staff</Button>
          )
        }
      />

      {live && capabilities?.canInvite && !capabilities.invitationsReady && (
        <p role="note" className="rounded-md border border-info/30 bg-info-muted px-3 py-2 text-sm text-info">{INVITATIONS_NOT_READY.replace(" No invitation was created and no email was sent.", "")}</p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="directory">Directory</TabsTrigger>
          {live && capabilities?.canViewInvitations && <TabsTrigger value="invitations">Invitations</TabsTrigger>}
          {/* The permission matrix is a hard-coded demo reference, not the clinic database's roles. */}
          {!live && <TabsTrigger value="permissions">Roles &amp; Permissions</TabsTrigger>}
        </TabsList>

        <TabsContent value="directory" className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search staff..." />
            <div className="flex gap-2">
              <Select value={role} onValueChange={(v) => { setRole(v as StaffRole | "all"); setPage(1); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
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
          {isError ? (
            <QueryError error={error} what="Staff" onRetry={() => refetch()} />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(s) => s.id}
                isLoading={isLoading}
                className="rounded-none border-0"
                emptyState={
                  <EmptyState
                    icon={ContactIcon}
                    title={filtered ? "No staff match these filters" : "No staff yet"}
                    description={
                      filtered ? "Try changing your search or filters." : live ? (capabilities?.canInvite ? "Invite your team to get started." : "No staff members are recorded for your branch.") : "Add a new staff member."
                    }
                  />
                }
              />
              {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
            </div>
          )}
        </TabsContent>

        {live && capabilities?.canViewInvitations && (
          <TabsContent value="invitations" className="mt-4">
            <InvitationsPanel onInvite={capabilities.canInvite && capabilities.invitationsReady ? () => setInviteOpen(true) : undefined} />
          </TabsContent>
        )}

        {!live && (
          <TabsContent value="permissions" className="mt-4 space-y-3">
            <Select value={matrixRole} onValueChange={(v) => setMatrixRole(v as StaffRole)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEMO_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <PermissionMatrix role={matrixRole} />
          </TabsContent>
        )}
      </Tabs>

      {/* Demo only (renders nothing with live data). */}
      <StaffFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      {live && capabilities?.canInvite && capabilities.invitationsReady && <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} />}
      {live && editingPhone && <EditPhoneDialog key={editingPhone.id} member={editingPhone} onOpenChange={(open) => !open && setEditingPhone(null)} />}
    </div>
  );
}
