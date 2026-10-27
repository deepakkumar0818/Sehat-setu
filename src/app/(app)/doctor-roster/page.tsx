"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGridIcon, ListIcon, MailPlusIcon, PlusIcon, UserRoundCogIcon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { DoctorCard } from "@/components/doctors/doctor-card";
import { DoctorActions } from "@/components/doctors/doctor-actions";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { Doctor } from "@/types";

type View = "list" | "grid";
/** The viewer's last choice, in this browser only (a convenience; list when unavailable). */
const VIEW_KEY = "sehat:doctors-view";
import { DoctorFormDialog } from "@/components/doctors/doctor-form-dialog";
import { QueryError } from "@/components/shared/query-error";
import { InviteStaffDialog } from "@/components/staff/invite-staff-dialog";
import { INVITATIONS_NOT_READY } from "@/components/staff/invitation-labels";
import { useDoctors, useSpecialtyOptions } from "@/hooks/use-people";
import { useBranches } from "@/hooks/use-branches";
import { useLiveData } from "@/lib/data-source";

export default function DoctorsPage() {
  const router = useRouter();
  const branches = useBranches();
  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  // ?invite=1: the dashboard's "Add Doctor" shortcut (shown only when allowed; the dialog needs canInvite too).
  const [inviteOpen, setInviteOpen] = useState(useSearchParams().get("invite") === "1");
  const live = useLiveData(); // live: doctors join through invitations, never created here
  const specialties = useSpecialtyOptions();

  const { data, isLoading, isError, error, refetch } = useDoctors({ search, specialization, branchId, page, pageSize: 12 });
  const caps = data && "capabilities" in data ? (data.capabilities as { canInviteDoctors?: boolean; invitationsReady?: boolean; canManageDoctors?: boolean } | undefined) : undefined;
  const canManage = live && Boolean(caps?.canManageDoctors);
  const [view, setView] = useState<View>("list");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "grid") setView("grid"); // eslint-disable-line react-hooks/set-state-in-effect -- read once after mount, so server and client render the same first
    } catch {
      // storage unavailable: keep the list
    }
  }, []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable: the choice lasts for this visit only
    }
  };

  const columns: DataTableColumn<Doctor>[] = [
    {
      key: "name",
      header: "Doctor",
      render: (d) => (
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={d.name} color={d.avatarColor} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{d.name}</p>
            <p className="truncate text-xs text-muted-foreground">{d.qualifications}</p>
          </div>
        </div>
      ),
    },
    { key: "specialty", header: "Specialty", render: (d) => <Badge variant="outline">{d.specialization}</Badge> },
    { key: "experience", header: "Experience", render: (d) => <span className="whitespace-nowrap text-muted-foreground">{d.experienceYears} yrs</span> },
    { key: "fee", header: "Fee", render: (d) => <span className="whitespace-nowrap font-medium">{formatCurrency(d.consultationFee)}</span> },
    { key: "contact", header: "Contact", render: (d) => (
      <div className="min-w-0 text-xs text-muted-foreground">
        <p className="truncate">{formatPhone(d.phone) || "—"}</p>
        <p className="truncate">{d.email}</p>
      </div>
    ) },
    {
      key: "status",
      header: "Status",
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge status={d.status} label={d.status === "inactive" ? "Suspended" : undefined} />
          {d.onlineConsultation && <Badge variant="outline" className="gap-1 border-info/30 text-info"><VideoIcon className="h-3 w-3" /> Online</Badge>}
        </div>
      ),
    },
    ...(canManage
      ? [{
          key: "actions",
          header: "",
          headClassName: "w-10",
          // Menu clicks (portalled, but bubbling through React) must not open the row.
          render: (d: Doctor) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><DoctorActions doctor={d} /></div>,
        }]
      : []),
  ];
  const mayInvite = live && Boolean(caps?.canInviteDoctors);
  const canInvite = mayInvite && Boolean(caps?.invitationsReady);
  const filtered = search !== "" || specialization !== "all" || branchId !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Doctors"
        description={live ? "Doctors registered with your clinic." : "Manage doctor profiles, availability, and performance."}
        actions={
          live ? (
            canInvite ? (
              <Button onClick={() => setInviteOpen(true)}><MailPlusIcon /> Invite doctor</Button>
            ) : mayInvite ? (
              <Button disabled title={INVITATIONS_NOT_READY}><MailPlusIcon /> Invite doctor (not set up yet)</Button>
            ) : undefined
          ) : (
            <Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Doctor</Button>
          )
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search doctors..." />
        <div className="flex flex-wrap gap-2">
          <Select value={specialization} onValueChange={(v) => { setSpecialization(v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All specializations</SelectItem>
              {(specialties.data ?? []).map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
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
        <div className="flex rounded-md border p-0.5 sm:ml-auto" role="group" aria-label="View">
          {([["list", ListIcon, "List view"], ["grid", LayoutGridIcon, "Grid view"]] as const).map(([v, Icon, label]) => (
            <Button key={v} type="button" variant={view === v ? "secondary" : "ghost"} size="sm" className="h-8 gap-1.5 px-2.5" aria-pressed={view === v} onClick={() => chooseView(v)}>
              <Icon className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{v === "list" ? "List" : "Grid"}</span>
              <span className="sr-only sm:hidden">{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <QueryError error={error} what="Doctors" onRetry={() => refetch()} />
      ) : isLoading && view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : !isLoading && (!data || data.items.length === 0) ? (
        <EmptyState
          icon={UserRoundCogIcon}
          title={filtered ? "No doctors match these filters" : "No doctors yet"}
          description={filtered ? "Try changing your filters." : live ? (canInvite ? "Invite a doctor to get started." : "No doctors are registered with your clinic yet.") : "Add a new doctor."}
          action={live ? (canInvite && !filtered ? <Button onClick={() => setInviteOpen(true)}><MailPlusIcon /> Invite doctor</Button> : undefined) : <Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Doctor</Button>}
        />
      ) : (
        <>
          {view === "list" ? (
            <div className="overflow-hidden rounded-lg border">
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(d) => d.id}
                isLoading={isLoading}
                className="rounded-none border-0"
                onRowClick={(d) => router.push(`/doctor-roster/${d.id}`)}
              />
              {data && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {(data?.items ?? []).map((d) => <DoctorCard key={d.id} doctor={d} actions={canManage ? <DoctorActions doctor={d} /> : undefined} />)}
              </div>
              {data && <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>}
            </>
          )}
        </>
      )}

      <DoctorFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/doctor-roster/${id}`)} />
      {canInvite && <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} role="DOCTOR" />}
    </div>
  );
}
