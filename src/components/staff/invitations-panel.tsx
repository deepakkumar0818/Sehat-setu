"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow, parseISO } from "date-fns";
import { MailIcon, MailPlusIcon, SendIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { ApiRequestError } from "@/lib/api-client";
import { useInvitations, useResendInvitation, useRevokeInvitation } from "@/hooks/use-invitations";
import type { StaffInvitation } from "@/lib/live-types";
import { DELIVERY_BADGE, DELIVERY_ERROR_TEXT, deliveryErrorSummary, ROLE_LABEL, STATE_BADGE } from "./invitation-labels";

// Live data only. Administrators can resend/revoke (the server enforces the
// 2-minute cooldown, 10-send limit and scope); Clinic Managers see their own
// branch's invitations read-only.

const relative = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "—";
  }
};

const STATUS_FILTERS = [
  { value: "all", label: "All invitations" },
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "accepted", label: "Accepted" },
  { value: "revoked", label: "Revoked" },
] as const;

export function InvitationsPanel({ onInvite }: { onInvite?: () => void }) {
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useInvitations({ status, page, pageSize: 10 });
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [revoking, setRevoking] = useState<StaffInvitation | null>(null);
  const canManage = data?.canManage ?? false;
  const emailOff = canManage && data?.emailConfigured === false;

  const doResend = (inv: StaffInvitation) =>
    resend.mutate(inv.id, {
      onSuccess: (r) =>
        r.delivery.status === "sent"
          ? toast.success(`Invitation re-sent to ${inv.email}. It now expires in 7 days.`)
          : toast.warning(`Invitation renewed, but the email couldn't be sent: ${DELIVERY_ERROR_TEXT[r.delivery.error ?? ""] ?? "unknown error"}.`),
    });

  const columns: DataTableColumn<StaffInvitation>[] = [
    {
      key: "person",
      header: "Invitee",
      render: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{i.name}</p>
          <p className="truncate text-xs text-muted-foreground">{i.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (i) => (
        <div>
          <p>{ROLE_LABEL[i.roleKey]}</p>
          {i.doctor && <p className="text-xs text-muted-foreground">{i.doctor.specialtyName} · Reg. {i.doctor.registrationNumber}</p>}
        </div>
      ),
    },
    { key: "branch", header: "Branch", render: (i) => i.branch.name },
    { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} label={STATE_BADGE[i.status].label} tone={STATE_BADGE[i.status].tone} /> },
    {
      key: "delivery",
      header: "Email",
      render: (i) =>
        i.status === "pending" || i.status === "expired" ? (
          <div>
            <StatusBadge status={i.delivery} label={DELIVERY_BADGE[i.delivery].label} tone={DELIVERY_BADGE[i.delivery].tone} />
            {i.delivery === "failed" && i.deliveryError && <p className="mt-1 text-xs text-muted-foreground">{deliveryErrorSummary(i.deliveryError)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{i.sendAttempts} of 10 sends</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "dates",
      header: "Dates",
      render: (i) => (
        <div className="text-xs text-muted-foreground">
          <p>Invited {relative(i.createdAt)}{i.invitedByName ? ` by ${i.invitedByName}` : ""}</p>
          {i.status === "pending" && <p>Expires {relative(i.expiresAt)}</p>}
          {i.status === "expired" && <p>Expired {relative(i.expiresAt)}</p>}
          {i.acceptedAt && <p>Accepted {relative(i.acceptedAt)}</p>}
          {i.revokedAt && <p>Revoked {relative(i.revokedAt)}</p>}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (i: StaffInvitation) =>
              i.status === "pending" || i.status === "expired" ? (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!i.canResend || emailOff || (resend.isPending && resend.variables === i.id)}
                    title={emailOff ? "Email sending isn't configured on the server yet." : i.resendAvailableAt ? `You can resend ${relative(i.resendAvailableAt)}.` : i.sendAttempts >= 10 ? "This invitation has reached the 10-send limit." : undefined}
                    onClick={() => doResend(i)}
                  >
                    <SendIcon /> Resend
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!i.canRevoke} onClick={() => setRevoking(i)}>
                    <XCircleIcon /> Revoke
                  </Button>
                </div>
              ) : null,
          } satisfies DataTableColumn<StaffInvitation>,
        ]
      : []),
  ];

  if (isError) {
    if (error instanceof ApiRequestError && error.code === "FEATURE_UNAVAILABLE") {
      return <EmptyState icon={MailIcon} title="Invitations aren't set up yet" description="Staff invitations haven't been enabled on this clinic database yet." />;
    }
    return <QueryError error={error} what="Invitations" onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        {!canManage && data && <p className="text-xs text-muted-foreground">Only clinic administrators can send, resend or revoke invitations.</p>}
      </div>
      {emailOff && (
        <p role="note" className="rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning">
          Email sending isn&apos;t configured on this server, so invitations are saved but not emailed. Set <code>SUPABASE_SECRET_KEY</code> in the
          server environment (<code>.env.local</code>) and restart the server; then use Resend. Resend stays disabled until then, so no attempts are used up.
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(i) => i.id}
          isLoading={isLoading}
          className="rounded-none border-0"
          emptyState={
            <EmptyState
              icon={MailPlusIcon}
              title={status === "all" ? "No invitations yet" : "No invitations match this filter"}
              description={canManage ? "Invite doctors and staff to join a branch of your clinic." : undefined}
              action={canManage && onInvite && status === "all" ? <Button onClick={onInvite}><MailPlusIcon /> Invite staff</Button> : undefined}
            />
          }
        />
        {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
      </div>

      <AlertDialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.name} ({revoking?.email}) won&apos;t be able to accept it. Nothing else changes; you can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revoking && revoke.mutate(revoking.id, { onSuccess: () => toast.success("Invitation revoked."), onSettled: () => setRevoking(null) })}
            >
              Revoke invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
