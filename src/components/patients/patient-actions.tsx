"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BanIcon, CircleCheckIcon, EllipsisVerticalIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useRemovePatient, useSetPatientAccess } from "@/hooks/use-patients";
import type { Patient } from "@/types";

// An Administrator's actions on a patient (live data): block — the record is
// inactive and the patient can't sign in to the portal, book or see their
// records online — unblock, or delete a patient with no history yet.

export function PatientActions({ patient, onDeleted, size = "icon" }: { patient: Pick<Patient, "id" | "name" | "status">; onDeleted?: () => void; size?: "icon" | "sm" }) {
  const [confirm, setConfirm] = useState<"block" | "delete" | null>(null);
  const setAccess = useSetPatientAccess();
  const remove = useRemovePatient();
  const blocked = patient.status !== "active";

  function change(status: "active" | "blocked") {
    setAccess.mutate(
      { id: patient.id, status },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(status === "active" ? `${patient.name} is unblocked.` : `${patient.name} is blocked.`);
        },
      }
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={size === "sm" ? "outline" : "ghost"} size={size} aria-label={`Actions for ${patient.name}`}>
            <EllipsisVerticalIcon className="h-4 w-4" aria-hidden />
            {size === "sm" && "More"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {blocked ? (
            <DropdownMenuItem onSelect={() => change("active")} disabled={setAccess.isPending}>
              <CircleCheckIcon aria-hidden /> Unblock
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm("block")}>
              <BanIcon aria-hidden /> Block
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
            <Trash2Icon aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "block"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Block ${patient.name}?`}
        description="They won't be able to sign in to the patient portal, book online or see their records there. Their records stay, and staff can still see them. You can unblock them at any time."
        confirmLabel="Block"
        destructive
        isLoading={setAccess.isPending}
        onConfirm={() => change("blocked")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${patient.name}?`}
        description="This permanently deletes the patient record and can't be undone. Only a patient with no appointments, bills, reports or documents can be deleted — otherwise block them, so their records are kept."
        confirmLabel="Delete patient"
        destructive
        isLoading={remove.isPending}
        onConfirm={() =>
          remove.mutate(patient.id, {
            onSuccess: () => {
              toast.success(`${patient.name} was deleted.`);
              onDeleted?.();
            },
            onSettled: () => setConfirm(null),
          })
        }
      />
    </>
  );
}
