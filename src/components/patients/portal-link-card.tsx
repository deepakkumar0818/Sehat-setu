"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CopyIcon, KeyRoundIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api-client";
import type { PortalLinkCode } from "@/lib/live-types";
import { useIssuePortalLinkCode, usePortalLinkStatus, useRevokePortalLinkCode } from "@/hooks/use-portal-link";

const when = (iso: string) => format(new Date(iso), "d MMM yyyy, h:mm a");

/**
 * P6.4: the patient's portal-account link, for staff holding patient.portal_link
 * (Administrator, Receptionist). Hidden for everyone else (the API answers 403).
 * Shows whether an account is linked (never which) and lets staff issue a
 * one-time code after the clinic's identity check, or revoke it.
 */
export function PortalLinkCard({ patientId }: { patientId: string }) {
  const status = usePortalLinkStatus(patientId);
  const revoke = useRevokePortalLinkCode(patientId);
  const [issueOpen, setIssueOpen] = useState(false);

  if (status.error instanceof ApiRequestError && (status.error.status === 403 || status.error.status === 404)) return null;
  if (status.isLoading || !status.data) {
    return status.isError ? (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">Couldn&apos;t load this patient&apos;s portal access.</p>
    ) : null;
  }
  const { linked, activeCode } = status.data;

  return (
    <section aria-label="Patient portal access" className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        {linked ? <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : <KeyRoundIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-foreground">Patient portal</p>
          <p className="text-muted-foreground">
            {linked
              ? "A portal account is linked. The patient can sign in to see reports you share with them."
              : activeCode
                ? `A linking code was issued ${when(activeCode.issuedAt)} and works until ${when(activeCode.expiresAt)}.`
                : "Not linked. After checking the patient's identity, issue a one-time code for them to enter after registering."}
          </p>
        </div>
      </div>
      {!linked && (
        <div className="flex shrink-0 gap-2">
          {activeCode && (
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(undefined, { onSuccess: () => toast.success("Linking code revoked."), onError: (e) => toast.error(e.message) })}
            >
              Revoke code
            </Button>
          )}
          <Button size="sm" onClick={() => setIssueOpen(true)}>
            {activeCode ? "Issue new code" : "Issue linking code"}
          </Button>
        </div>
      )}
      {issueOpen && <IssueCodeDialog patientId={patientId} replaces={Boolean(activeCode)} onClose={() => setIssueOpen(false)} />}
    </section>
  );
}

function IssueCodeDialog({ patientId, replaces, onClose }: { patientId: string; replaces: boolean; onClose: () => void }) {
  const issue = useIssuePortalLinkCode(patientId);
  const [verified, setVerified] = useState(false);
  // Held only in this dialog's state; gone when it closes. Never logged.
  const [issued, setIssued] = useState<PortalLinkCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    issue.mutate(undefined, { onSuccess: setIssued, onError: (e) => setError(e.message) });
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      toast.success("Code copied.");
    } catch {
      toast.error("Couldn't copy — please read the code out instead.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{issued ? "Give this code to the patient" : "Issue a portal linking code"}</DialogTitle>
          <DialogDescription>
            {issued
              ? "It's shown only once and works one time. The patient enters it after registering and confirming their email."
              : "The code connects a patient's portal account to this record, so only give it to the patient in person after checking their identity."}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="space-y-3">
            <p className="rounded-md border bg-muted/50 px-3 py-4 text-center font-mono text-xl tracking-widest text-foreground" aria-label="Linking code">
              {issued.code}
            </p>
            <p className="text-sm text-muted-foreground">Works until {when(issued.expiresAt)}. Don&apos;t send it by SMS, email or phone to anyone whose identity you haven&apos;t checked.</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Follow your clinic&apos;s identity-verification procedure before issuing a code.</li>
              <li>Give the code only to the patient (or their authorised guardian).</li>
              {replaces && <li>Issuing a new code cancels the previous one.</li>}
            </ul>
            <label className="flex items-start gap-2">
              <Checkbox checked={verified} onCheckedChange={(v) => setVerified(v === true)} aria-label="I verified this patient's identity" />
              <span>I have verified this patient&apos;s identity in line with the clinic&apos;s procedure.</span>
            </label>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {issued ? (
            <>
              <Button variant="outline" onClick={copy}>
                <CopyIcon /> Copy
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={issue.isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!verified || issue.isPending}>
                {issue.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Issue code
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
