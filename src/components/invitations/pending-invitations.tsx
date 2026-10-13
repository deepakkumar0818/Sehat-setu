"use client";

import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Building2Icon, CheckIcon, Loader2Icon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ApiRequestError } from "@/lib/api-client";
import { useAcceptInvitation, useMyInvitations } from "@/hooks/use-invitations";
import { ROLE_LABEL } from "@/components/staff/invitation-labels";
import type { MyInvitation } from "@/lib/live-types";

// The signed-in user's own pending invitations. Accepting is explicit: nothing
// in the clinic is visible until they press Accept and the server has checked
// the invitation (owner, verified email, status, expiry, role, branch).

const until = (iso: string) => {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "";
  }
};

function InvitationCard({ inv }: { inv: MyInvitation }) {
  const accept = useAcceptInvitation();
  const [done, setDone] = useState(false);
  const onAccept = () =>
    accept.mutate(inv.id, {
      onSuccess: () => {
        setDone(true);
        // A full navigation so the server re-resolves memberships for the new clinic.
        window.location.assign(new URL("/dashboard", window.location.origin).href);
      },
    });
  const error = accept.error instanceof ApiRequestError ? accept.error : null;

  return (
    <div className="rounded-lg border bg-card p-4 text-left">
      <div className="flex items-start gap-3">
        <Building2Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{inv.clinicName}</p>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABEL[inv.roleKey] ?? inv.roleKey} · {inv.branchName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{inv.expired ? `Expired ${until(inv.expiresAt)}` : `Expires ${until(inv.expiresAt)}`}</p>
        </div>
      </div>
      {inv.expired ? (
        <p className="mt-3 text-sm text-warning">This invitation has expired. Ask the clinic administrator to resend it.</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={onAccept} disabled={accept.isPending || done}>
            {accept.isPending || done ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Accept invitation
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error.message}
        </p>
      )}
    </div>
  );
}

export function PendingInvitations() {
  const { data, isLoading, isError, error, refetch } = useMyInvitations();
  if (isLoading) return <Skeleton className="h-28 w-full" />;
  if (isError) {
    if (error instanceof ApiRequestError && error.code === "FEATURE_UNAVAILABLE") {
      return <EmptyState icon={MailIcon} title="Invitations aren't available yet" description="Staff invitations haven't been set up on this server yet." />;
    }
    if (error instanceof ApiRequestError && error.code === "EMAIL_NOT_VERIFIED") {
      return <EmptyState icon={MailIcon} title="Confirm your email first" description={error.message} />;
    }
    return <ErrorState title="Couldn't load your invitations" description={error.message} onRetry={() => refetch()} />;
  }
  if (!data || data.items.length === 0) {
    return <EmptyState icon={MailIcon} title="No pending invitations" description="If a clinic invited you, make sure you signed in with the email address the invitation was sent to." />;
  }
  return (
    <div className="space-y-3">
      {data.items.map((inv) => (
        <InvitationCard key={inv.id} inv={inv} />
      ))}
    </div>
  );
}
