"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClockIcon, MoreHorizontalIcon, PlayCircleIcon, ReceiptIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  useCancelAppointment,
  useCheckInAppointment,
  useMarkNoShow,
  useRescheduleAppointment,
  useStartConsultation,
} from "@/hooks/use-appointments";
import { useCreateInvoiceForAppointment } from "@/hooks/use-billing";
import type { AppointmentWithNames } from "@/services/appointments";
import { useLiveData } from "@/lib/data-source";

export function AppointmentActionsMenu({ appointment }: { appointment: AppointmentWithNames }) {
  const router = useRouter();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [date, setDate] = useState(appointment.date);
  const [time, setTime] = useState(appointment.time);

  const checkIn = useCheckInAppointment();
  const cancel = useCancelAppointment();
  const markNoShow = useMarkNoShow();
  const reschedule = useRescheduleAppointment();
  const startConsultation = useStartConsultation();
  const createInvoice = useCreateInvoiceForAppointment();
  const live = useLiveData();
  // Live: only the appointment's own doctor starts or continues its consultation (the server enforces it).
  const canStart = live ? Boolean(appointment.canConsult) : true;
  const canContinue = live ? Boolean(appointment.canConsult && appointment.consultationId) : Boolean(appointment.consultationId);
  // Live billing: open an existing invoice, or create one if the server says this user may.
  const showBilling = live
    ? !appointment.billingHidden && appointment.status !== "cancelled" && (Boolean(appointment.invoiceId) || Boolean(appointment.canCreateInvoice))
    : (appointment.status === "completed" || appointment.paymentStatus !== "paid") && appointment.status !== "cancelled";

  const handleStartConsultation = () => {
    startConsultation.mutate(appointment.id, {
      onSuccess: ({ consultation }) => {
        toast.success("Consultation started");
        router.push(`/consultations/${consultation.id}`);
      },
    });
  };

  const handleCollectPayment = () => {
    if (appointment.invoiceId) {
      router.push(`/billing/${appointment.invoiceId}`);
      return;
    }
    createInvoice.mutate(appointment.id, {
      onSuccess: (invoice) => {
        toast.success("Invoice created");
        router.push(`/billing/${invoice.id}`);
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Appointment actions">
            <MoreHorizontalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {appointment.status === "upcoming" && (
            <DropdownMenuItem onClick={() => checkIn.mutate(appointment.id)}>Check in</DropdownMenuItem>
          )}
          {canStart && appointment.status === "waiting" && (
            <DropdownMenuItem onClick={handleStartConsultation}>
              <PlayCircleIcon /> Start consultation
            </DropdownMenuItem>
          )}
          {canContinue && appointment.status === "in_consultation" && (
            <DropdownMenuItem onClick={() => router.push(`/consultations/${appointment.consultationId}`)}>
              <PlayCircleIcon /> Continue consultation
            </DropdownMenuItem>
          )}
          {(appointment.status === "upcoming" || appointment.status === "waiting") && (
            <DropdownMenuItem onClick={() => setRescheduleOpen(true)}>
              <CalendarClockIcon /> Reschedule
            </DropdownMenuItem>
          )}
          {appointment.status === "waiting" && (
            <DropdownMenuItem onClick={() => markNoShow.mutate(appointment.id)}>Mark no-show</DropdownMenuItem>
          )}
          {showBilling && (
            <DropdownMenuItem onClick={handleCollectPayment}>
              <ReceiptIcon /> {appointment.invoiceId ? "View invoice" : "Collect payment"}
            </DropdownMenuItem>
          )}
          {(appointment.status === "upcoming" || appointment.status === "waiting") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setCancelOpen(true)}>
                <XCircleIcon /> Cancel appointment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule appointment</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date">Date</Label>
              <Input id="reschedule-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-time">Time</Label>
              <Input id="reschedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reschedule.isPending}
              onClick={() =>
                reschedule.mutate(
                  { id: appointment.id, date, time },
                  {
                    onSuccess: () => {
                      toast.success("Appointment rescheduled");
                      setRescheduleOpen(false);
                    },
                  }
                )
              }
            >
              {reschedule.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this appointment?"
        description={`This will cancel the appointment for ${appointment.patientName} on ${appointment.date} at ${appointment.time}.`}
        confirmLabel="Cancel appointment"
        destructive
        isLoading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(appointment.id, {
            onSuccess: () => {
              toast.success("Appointment cancelled");
              setCancelOpen(false);
            },
          })
        }
      />
    </>
  );
}
