"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarClockIcon, CheckIcon, ClipboardListIcon, VideoIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApproveBookingRequest, useBookingRequests, useRefundsNeedingAttention, useRejectBookingRequest, useRetryRefund } from "@/hooks/use-booking-requests";
import { ApiRequestError } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BookingRequest } from "@/lib/live-types";
import { cn } from "@/lib/utils";

// "Pending Patient Bookings": requests patients made in the portal, awaiting
// reception. Shown only to staff who may decide (appointment.update); the
// server and the database re-check the permission, the branch scope, the state
// and — for approval — the slot, under the same lock as every booking.

const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const errorText = (err: unknown) => (err instanceof ApiRequestError || err instanceof Error ? err.message : "Something went wrong. Please try again.");

export function PendingBookingRequests({ branchId, className }: { branchId?: string; className?: string }) {
  const query = useBookingRequests(branchId === "all" ? undefined : branchId);
  const approve = useApproveBookingRequest();
  const [rejecting, setRejecting] = useState<BookingRequest | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Not permitted (403): the section isn't shown at all.
  if (query.error instanceof ApiRequestError && query.error.status === 403) return null;
  const items = query.data?.items ?? [];

  function onApprove(r: BookingRequest) {
    if (busyId) return; // one decision at a time; repeated clicks do nothing
    setBusyId(r.id);
    setErrors((e) => ({ ...e, [r.id]: "" }));
    approve.mutate(r.id, {
      onSuccess: () => toast.success(`Approved: ${r.patientName} with ${r.doctorName}, ${formatDate(r.date)} at ${time12(r.time)}.`),
      onError: (err) => setErrors((e) => ({ ...e, [r.id]: errorText(err) })),
      onSettled: () => setBusyId(null),
    });
  }

  return (
    <section id="booking-requests" aria-labelledby="booking-requests-title" className={cn("rounded-xl border bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardListIcon className="h-4 w-4 text-primary" aria-hidden />
          <h2 id="booking-requests-title" className="text-sm font-semibold text-foreground">Pending Patient Bookings</h2>
          {query.data && <Badge variant="outline" className={query.data.total > 0 ? "border-warning/30 text-warning" : undefined}>{query.data.total}</Badge>}
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">Requests from the patient portal. They aren&apos;t on any doctor&apos;s schedule until approved.</p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : query.error ? (
        <div className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-danger">Couldn&apos;t load booking requests.</span>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No requests waiting. New portal bookings will appear here.</p>
      ) : (
        <ul className="divide-y">
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="booking-request">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  {r.patientName}
                  {r.patientNumber && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.patientNumber}</span>}
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
                  <CalendarClockIcon className="h-3.5 w-3.5" aria-hidden />
                  <span className={r.expired ? "line-through" : "text-foreground"}>{formatDate(r.date)} at {time12(r.time)}</span>
                  <span>· {r.doctorName}{r.specialty ? ` (${r.specialty})` : ""} · {r.branchName}</span>
                  {r.type === "online" && <span className="inline-flex items-center gap-1"><VideoIcon className="h-3.5 w-3.5" aria-hidden /> Online</span>}
                </p>
                <p className="text-muted-foreground">Reason: <span className="text-foreground">{r.reason}</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {r.expired && <Badge variant="outline" className="border-danger/30 text-danger">Time has passed</Badge>}
                  {r.hasSymptomReport && <Badge variant="outline">Symptoms submitted</Badge>}
                  {r.feePaid !== null && <Badge variant="outline" className="border-success/30 text-success">Fee paid online {formatCurrency(r.feePaid)}</Badge>}
                </div>
                {errors[r.id] && <p role="alert" className="text-sm text-danger">{errors[r.id]}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => onApprove(r)} disabled={r.expired || busyId !== null} aria-label={`Approve request from ${r.patientName}`}>
                  <CheckIcon /> {busyId === r.id && approve.isPending ? "Approving…" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(r)} disabled={busyId !== null} aria-label={`Reject request from ${r.patientName}`}>
                  <XIcon /> Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.data && query.data.total > items.length && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing the first {items.length} of {query.data.total} requests.</p>
      )}

      <RefundsNeedingAttention />

      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />}
    </section>
  );
}

function RejectDialog({ request, onClose }: { request: BookingRequest; onClose: () => void }) {
  const reject = useRejectBookingRequest();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(open) => !open && !reject.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this booking request?</DialogTitle>
          <DialogDescription>
            {request.patientName} · {request.doctorName} · {formatDate(request.date)} at {time12(request.time)}. The slot is freed and the patient sees your reason in
            the portal.{request.feePaid !== null && ` The ${formatCurrency(request.feePaid)} paid online is refunded automatically.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || reject.isPending) return;
            setError(null);
            reject.mutate(
              { id: request.id, reason: reason.trim() },
              {
                onSuccess: (res) => {
                  if (res.feeRefund === "pending") toast.warning(`Declined. The online fee refund didn't go through yet; retry it below.`);
                  else toast.success(`Request from ${request.patientName} declined${res.feeRefund === "refunded" ? " and the fee refunded" : ""}.`);
                  onClose();
                },
                onError: (err) => setError(errorText(err)),
              }
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason for the patient</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The doctor is on leave that day. Please book another date."
            />
            <p className="text-xs text-muted-foreground">Shown to the patient. Don&apos;t include medical details.</p>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={reject.isPending}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!valid || reject.isPending}>{reject.isPending ? "Rejecting…" : "Reject request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Online refunds Razorpay didn't complete (e.g. it was unreachable): shown only when there are some. */
function RefundsNeedingAttention() {
  const query = useRefundsNeedingAttention();
  const retry = useRetryRefund();
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="border-t bg-warning/5 px-4 py-3" data-testid="refunds-attention">
      <p className="text-sm font-medium text-warning">Online refunds waiting ({items.length})</p>
      <ul className="mt-2 space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-foreground">
              {r.patientName} <span className="text-muted-foreground">{r.patientNumber}</span> · {formatCurrency(r.amount)} · {r.reason ?? "Refund"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(r.id, {
                  onSuccess: (res) => (res.refunded ? toast.success("Refund sent.") : toast.error("Razorpay didn't accept the refund yet. Try again later.")),
                  onError: (err) => toast.error(errorText(err)),
                })
              }
            >
              Retry refund
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
