"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlayCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateAppointment, useStartConsultation } from "@/hooks/use-appointments";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";
import { DEMO_NOW, todayDateStr } from "@/lib/demo-clock";
import type { Doctor, Patient } from "@/types";
import { useLiveData } from "@/lib/data-source";

const NO_DOCTORS: Doctor[] = [];

export function StartConsultationButton({ patient }: { patient: Patient }) {
  const router = useRouter();
  const user = useCurrentUser();
  const live = useLiveData();
  // Demo mode only (this button is hidden with live data); never the demo store when live.
  const allDoctors = useDataStore((s) => (live ? NO_DOCTORS : s.db.doctors));
  const doctors = useMemo(
    () => allDoctors.filter((d) => d.status === "active" && d.branchId === patient.branchId),
    [allDoctors, patient.branchId]
  );
  const createAppointment = useCreateAppointment();
  const startConsultation = useStartConsultation();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [doctorId, setDoctorId] = useState(user?.doctorId ?? doctors[0]?.id ?? "");
  const isBusy = createAppointment.isPending || startConsultation.isPending;

  const runFlow = (resolvedDoctorId: string) => {
    const doctor = doctors.find((d) => d.id === resolvedDoctorId) ?? doctors[0];
    if (!doctor) {
      toast.error("No active doctor available at this branch.");
      return;
    }
    createAppointment.mutate(
      {
        patientId: patient.id,
        doctorId: doctor.id,
        branchId: patient.branchId,
        date: todayDateStr(),
        time: DEMO_NOW.toTimeString().slice(0, 5),
        type: "walk_in",
        reason: "Walk-in consultation",
        fee: doctor.consultationFee,
      },
      {
        onSuccess: (appt) => {
          startConsultation.mutate(appt.id, {
            onSuccess: ({ consultation }) => {
              setPickerOpen(false);
              router.push(`/consultations/${consultation.id}`);
            },
          });
        },
      }
    );
  };

  const handleClick = () => {
    if (user?.role === "doctor" && user.doctorId) {
      runFlow(user.doctorId);
    } else {
      setPickerOpen(true);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={handleClick} disabled={isBusy}>
        <PlayCircleIcon /> Start Consultation
      </Button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a walk-in consultation</DialogTitle>
            <DialogDescription>Select the doctor who will see {patient.name} now.</DialogDescription>
          </DialogHeader>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select doctor" /></SelectTrigger>
            <SelectContent>
              {doctors.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name} · {d.specialization}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button onClick={() => runFlow(doctorId)} disabled={!doctorId || isBusy}>
              {isBusy ? "Starting…" : "Start consultation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
