"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { StethoscopeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { useConsultations } from "@/hooks/use-clinical";

// Live: a prescription belongs to a consultation, so "New Prescription" means
// picking one of the doctor's consultations (the server lists only their own)
// and opening the prescription form there.
export function NewLivePrescriptionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useConsultations({ status: "all", page: 1, pageSize: 10 });
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New prescription</DialogTitle>
          <DialogDescription>Choose the consultation this prescription is for.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : isError ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Couldn&apos;t load your consultations.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-1 rounded-lg border border-dashed p-4 text-sm">
            <p className="font-medium text-foreground">No consultations yet</p>
            <p className="text-muted-foreground">
              Check the patient in, then choose <span className="font-medium">Start consultation</span> from their appointment. The prescription is written from there.
            </p>
          </div>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/consultations/${c.id}?prescribe=1`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{c.patientName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[formatDate(c.date), c.chiefComplaint].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" asChild>
            <Link href="/waiting-room"><StethoscopeIcon /> Today&apos;s patients</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
