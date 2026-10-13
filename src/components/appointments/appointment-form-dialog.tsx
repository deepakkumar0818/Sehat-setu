"use client";

import { useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatientCombobox } from "@/components/patients/patient-combobox";
import { useCreateAppointment } from "@/hooks/use-appointments";
import { useDataStore } from "@/store/data-store";
import { useDoctorOptions } from "@/hooks/use-people";
import { useLiveData, useTodayKey } from "@/lib/data-source";
import { formatCurrency } from "@/lib/format";
import type { AppointmentType } from "@/types";

const appointmentSchema = z.object({
  patientId: z.string().min(1, "Select a patient"),
  doctorId: z.string().min(1, "Select a doctor"),
  date: z.string().min(1, "Select a date"),
  time: z.string().min(1, "Select a time"),
  type: z.enum(["in_person", "online", "follow_up", "walk_in"]),
  reason: z.string().min(2, "Enter a reason for the visit"),
  notes: z.string().optional(),
});

type AppointmentFormValues = z.infer<typeof appointmentSchema>;

interface AppointmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId?: string;
  onCreated?: (appointmentId: string) => void;
}

export function AppointmentFormDialog({ open, onOpenChange, patientId, onCreated }: AppointmentFormDialogProps) {
  const live = useLiveData();
  const today = useTodayKey();
  const allDoctors = useDoctorOptions();
  const doctors = useMemo(() => allDoctors.filter((d) => d.status === "active"), [allDoctors]);
  const createAppointment = useCreateAppointment();

  const { register, control, handleSubmit, watch, reset, formState: { errors } } = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      patientId: patientId ?? "",
      doctorId: "",
      date: today,
      time: "10:00",
      type: "in_person",
      reason: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({ patientId: patientId ?? "", doctorId: "", date: today, time: "10:00", type: "in_person", reason: "", notes: "" });
    }
  }, [open, patientId, reset, today]);

  const doctorId = watch("doctorId");
  const type = watch("type");
  const selectedDoctor = useMemo(() => doctors.find((d) => d.id === doctorId), [doctors, doctorId]);

  const fee = useMemo(() => {
    if (!selectedDoctor) return 0;
    if (type === "follow_up") return Math.round((selectedDoctor.consultationFee * 0.5) / 50) * 50;
    if (type === "online") return Math.round((selectedDoctor.consultationFee * 0.9) / 50) * 50;
    return selectedDoctor.consultationFee;
  }, [selectedDoctor, type]);

  const onSubmit = (values: AppointmentFormValues) => {
    // Live: the server picks and verifies the branch (the doctor's, within the user's access).
    const patient = live ? undefined : useDataStore.getState().db.patients.find((p) => p.id === values.patientId);
    createAppointment.mutate(
      { ...values, branchId: live ? "" : (patient?.branchId ?? selectedDoctor?.branchId ?? ""), fee },
      {
        onSuccess: (appt) => {
          toast.success("Appointment booked.");
          onOpenChange(false);
          onCreated?.(appt.id);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Book appointment</DialogTitle>
          <DialogDescription>Schedule a new appointment for a patient.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Patient</Label>
            <Controller
              control={control}
              name="patientId"
              render={({ field }) => <PatientCombobox value={field.value} onChange={field.onChange} disabled={Boolean(patientId)} />}
            />
            {errors.patientId && <p className="text-xs text-danger">{errors.patientId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Doctor</Label>
              <Controller
                control={control}
                name="doctorId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                    <SelectContent>
                      {doctors.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name} · {d.specialization}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.doctorId && <p className="text-xs text-danger">{errors.doctorId.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as AppointmentType)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_person">In-person</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                      <SelectItem value="walk_in">Walk-in</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="appt-date">Date</Label>
              <Input id="appt-date" type="date" min={today} {...register("date")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-time">Time</Label>
              <Input id="appt-time" type="time" {...register("time")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appt-reason">Reason for visit</Label>
            <Input id="appt-reason" placeholder="e.g. Fever and cold" {...register("reason")} />
            {errors.reason && <p className="text-xs text-danger">{errors.reason.message}</p>}
          </div>

          {selectedDoctor && (
            <p className="text-sm text-muted-foreground">
              Consultation fee: <span className="font-medium text-foreground">{formatCurrency(fee)}</span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createAppointment.isPending}>
              {createAppointment.isPending ? "Booking…" : "Book appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
