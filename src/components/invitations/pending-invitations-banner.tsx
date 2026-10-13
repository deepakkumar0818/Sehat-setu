"use client";

import Link from "next/link";
import { MailIcon } from "lucide-react";
import { useLiveData } from "@/lib/data-source";
import { useMyInvitations } from "@/hooks/use-invitations";

/** Staff app (live data only): tells an existing staff member they've been invited to another clinic/branch. */
export function PendingInvitationsBanner() {
  const live = useLiveData();
  const { data } = useMyInvitations(live);
  const pending = data?.items.filter((i) => !i.expired).length ?? 0;
  if (!live || pending === 0) return null;
  return (
    <div role="note" className="mb-4 flex items-center gap-2 rounded-md border border-info/30 bg-info-muted px-3 py-2 text-sm text-info print:hidden">
      <MailIcon className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        You have {pending} pending invitation{pending === 1 ? "" : "s"} to join a clinic.{" "}
        <Link href="/invitations" className="font-medium underline">
          Review
        </Link>
      </span>
    </div>
  );
}
