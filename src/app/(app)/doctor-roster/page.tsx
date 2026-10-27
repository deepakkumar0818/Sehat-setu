"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailPlusIcon, PlusIcon, UserRoundCogIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { EmptyState } from "@/components/shared/empty-state";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { DoctorCard } from "@/components/doctors/doctor-card";
import { DoctorActions } from "@/components/doctors/doctor-actions";
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const live = useLiveData(); // live: doctors join through invitations, never created here
  const specialties = useSpecialtyOptions();

  const { data, isLoading, isError, error, refetch } = useDoctors({ search, specialization, branchId, page, pageSize: 12 });
  const caps = data && "capabilities" in data ? (data.capabilities as { canInviteDoctors?: boolean; invitationsReady?: boolean; canManageDoctors?: boolean } | undefined) : undefined;
  const canManage = live && Boolean(caps?.canManageDoctors);
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
        <div className="flex gap-2">
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
      </div>

      {isError ? (
        <QueryError error={error} what="Doctors" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={UserRoundCogIcon}
          title={filtered ? "No doctors match these filters" : "No doctors yet"}
          description={filtered ? "Try changing your filters." : live ? (canInvite ? "Invite a doctor to get started." : "No doctors are registered with your clinic yet.") : "Add a new doctor."}
          action={live ? (canInvite && !filtered ? <Button onClick={() => setInviteOpen(true)}><MailPlusIcon /> Invite doctor</Button> : undefined) : <Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Doctor</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((d) => <DoctorCard key={d.id} doctor={d} actions={canManage ? <DoctorActions doctor={d} /> : undefined} />)}
          </div>
          <div className="rounded-lg border"><DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /></div>
        </>
      )}

      <DoctorFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/doctor-roster/${id}`)} />
      {canInvite && <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} role="DOCTOR" />}
    </div>
  );
}
