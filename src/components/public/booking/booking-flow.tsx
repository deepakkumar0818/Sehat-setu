"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useDoctor } from "@/hooks/use-people";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";
import { useCreatePaymentIntent, useConfirmPayment, useSubmitBooking } from "@/hooks/use-booking";
import type { BookingConfirmation } from "@/services/booking";
import type { AppointmentType, Doctor, PaymentMethod } from "@/types";
import { BookingStepper } from "@/components/public/booking/booking-stepper";
import { BookingDoctorStep } from "@/components/public/booking/booking-doctor-step";
import { BookingDateTimeStep } from "@/components/public/booking/booking-datetime-step";
import { BookingDetailsStep, type BookingDetails } from "@/components/public/booking/booking-details-step";
import { BookingAuthStep } from "@/components/public/booking/booking-auth-step";
import { BookingPaymentStep } from "@/components/public/booking/booking-payment-step";
import { BookingConfirmationStep } from "@/components/public/booking/booking-confirmation-step";
import { todayDateStr } from "@/lib/demo-clock";

type Phase = "doctor" | "datetime" | "details" | "auth" | "payment" | "confirmation";

const PHASE_TO_STEP: Record<Phase, number> = {
  doctor: 1,
  datetime: 2,
  details: 3,
  auth: 3,
  payment: 4,
  confirmation: 5,
};

interface BookingFlowProps {
  initialDoctorId?: string;
}

export function BookingFlow({ initialDoctorId }: BookingFlowProps) {
  const router = useRouter();
  const user = useCurrentUser();
  const branches = useDataStore((s) => s.db.branches);

  const { data: preselectedDoctor, isLoading: loadingPreselected } = useDoctor(initialDoctorId);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const doctor = selectedDoctor ?? preselectedDoctor ?? null;

  const [phase, setPhase] = useState<Phase>(initialDoctorId ? "datetime" : "doctor");
  const [type, setType] = useState<AppointmentType>("in_person");
  const [date, setDate] = useState(todayDateStr());
  const [time, setTime] = useState<string | null>(null);
  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [patientId, setPatientId] = useState<string | null>(user?.patientId ?? null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const createIntent = useCreatePaymentIntent();
  const confirmPayment = useConfirmPayment();
  const submitBooking = useSubmitBooking();

  const fee = useMemo(() => {
    if (!doctor) return 0;
    return type === "online" ? Math.round((doctor.consultationFee * 0.9) / 50) * 50 : doctor.consultationFee;
  }, [doctor, type]);

  const clinicName = useMemo(() => {
    if (!doctor) return "";
    return branches.find((b) => b.id === doctor.branchId)?.name ?? "Sehat Setu Clinic";
  }, [doctor, branches]);

  if (initialDoctorId && loadingPreselected && !selectedDoctor) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const goBack = () => {
    if (phase === "datetime") {
      if (initialDoctorId) router.back();
      else setPhase("doctor");
    } else if (phase === "details") setPhase("datetime");
    else if (phase === "auth") setPhase("details");
    else if (phase === "payment") setPhase(user?.patientId ? "details" : "auth");
  };

  const handlePay = async (method: PaymentMethod) => {
    if (!doctor || !date || !time || !details || !patientId) return;
    setIsProcessing(true);
    try {
      const intent = await createIntent.mutateAsync(fee);
      await confirmPayment.mutateAsync({ intentId: intent.intentId, method });
      const result = await submitBooking.mutateAsync({
        patientId,
        doctorId: doctor.id,
        branchId: doctor.branchId,
        date,
        time,
        type,
        reason: details.reason,
        fee,
        paymentMethod: method,
      });
      setConfirmation(result);
      setPhase("confirmation");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {phase !== "confirmation" && (
        <>
          <BookingStepper currentStep={PHASE_TO_STEP[phase]} />
          {doctor && phase !== "doctor" && (
            <div className="mt-5 flex items-center gap-2.5 rounded-lg border bg-card p-3">
              <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doctor.name}</p>
                <p className="truncate text-xs text-muted-foreground">{doctor.specialization} · {clinicName}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={goBack}>
                <ChevronLeftIcon className="h-4 w-4" /> Back
              </Button>
            </div>
          )}
        </>
      )}

      <div className="mt-6 rounded-2xl border bg-card p-5 sm:p-7">
        {phase === "doctor" && (
          <BookingDoctorStep
            onSelect={(d) => {
              setSelectedDoctor(d);
              setPhase("datetime");
            }}
          />
        )}

        {phase === "datetime" && doctor && (
          <>
            <BookingDateTimeStep
              doctor={doctor}
              type={type}
              onTypeChange={setType}
              date={date}
              onDateChange={(d) => {
                setDate(d);
                setTime(null);
              }}
              time={time}
              onTimeChange={setTime}
            />
            <div className="mt-5 flex justify-end">
              <Button size="lg" disabled={!time} onClick={() => setPhase("details")}>
                Continue
              </Button>
            </div>
          </>
        )}

        {phase === "details" && (
          <BookingDetailsStep
            defaultValues={details ?? {}}
            onSubmit={(values) => {
              setDetails(values);
              if (user?.patientId) {
                setPatientId(user.patientId);
                setPhase("payment");
              } else {
                setPhase("auth");
              }
            }}
          />
        )}

        {phase === "auth" && details && (
          <BookingAuthStep
            name={details.name}
            phone={details.phone}
            email={details.email}
            onAuthenticated={(id) => {
              setPatientId(id);
              setPhase("payment");
            }}
          />
        )}

        {phase === "payment" && (
          <BookingPaymentStep amount={fee} isProcessing={isProcessing} onPay={handlePay} />
        )}

        {phase === "confirmation" && confirmation && doctor && (
          <BookingConfirmationStep confirmation={confirmation} doctor={doctor} clinicName={clinicName} />
        )}
      </div>

      {phase === "confirmation" && (
        <div className="mt-4 text-center">
          <Button variant="link" onClick={() => router.push("/doctors")}>
            Book another appointment
          </Button>
        </div>
      )}
    </div>
  );
}
