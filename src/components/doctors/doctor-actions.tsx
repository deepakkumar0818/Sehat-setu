"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BanIcon, CircleCheckIcon, EllipsisVerticalIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useRemoveDoctor, useSetDoctorStatus } from "@/hooks/use-people";
import type { Doctor } from "@/types";

// An Administrator's actions on a doctor (live data): suspend — the doctor
// can't sign in to this clinic and isn't offered for booking — reactivate, or
// delete a doctor who has no appointments or lab reports yet.

export function DoctorActions({ doctor, onDeleted, className }: { doctor: Pick<Doctor, "id" | "name" | "status">; onDeleted?: () => void; className?: string }) {
  const [confirm, setConfirm] = useState<"suspend" | "delete" | null>(null);
  const setStatus = useSetDoctorStatus();
  const remove = useRemoveDoctor();
  const suspended = doctor.status === "inactive";

  function changeStatus(status: Doctor["status"]) {
    setStatus.mutate(
      { id: doctor.id, status },
      {
        onSuccess: (r) => {
          setConfirm(null);
          if (status === "active") return toast.success(`${doctor.name} is active again.`);
          toast.success(
            `${doctor.name} is suspended.`,
            r.upcomingAppointments > 0 ? { description: `${r.upcomingAppointments} upcoming appointment${r.upcomingAppointments === 1 ? " is" : "s are"} still booked — reschedule or cancel them in Appointments.` } : undefined
          );
        },
      }
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={className} aria-label={`Actions for ${doctor.name}`}>
            <EllipsisVerticalIcon className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {suspended ? (
            <DropdownMenuItem onSelect={() => changeStatus("active")} disabled={setStatus.isPending}>
              <CircleCheckIcon aria-hidden /> Reactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm("suspend")}>
              <BanIcon aria-hidden /> Suspend / block
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
            <Trash2Icon aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "suspend"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Suspend ${doctor.name}?`}
        description="They won't be able to sign in to this clinic, and patients can't book them online or through your clinic link. Their appointments and records stay. You can reactivate them at any time."
        confirmLabel="Suspend"
        destructive
        isLoading={setStatus.isPending}
        onConfirm={() => changeStatus("inactive")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Delete ${doctor.name}?`}
        description="This permanently removes the doctor from your clinic and can't be undone. Only a doctor with no appointments or lab reports can be deleted — otherwise suspend them, so patients' records keep their doctor."
        confirmLabel="Delete doctor"
        destructive
        isLoading={remove.isPending}
        onConfirm={() =>
          remove.mutate(doctor.id, {
            onSuccess: () => {
              setConfirm(null);
              toast.success(`${doctor.name} was deleted.`);
              onDeleted?.();
            },
            onError: () => setConfirm(null),
          })
        }
      />
    </>
  );
}
