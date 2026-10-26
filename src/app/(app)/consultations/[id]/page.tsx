"use client";

import { use, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheckIcon, FileSignatureIcon, FlaskConicalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TagInput } from "@/components/shared/tag-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { AINotesAssistant } from "@/components/consultations/ai-notes-assistant";
import { PrescriptionBuilderDialog } from "@/components/prescriptions/prescription-builder-dialog";
import { ConsultationLabResults } from "@/components/lab-reports/consultation-lab-results";
import { LAB_REPORT_TYPES, SYMPTOMS, DIAGNOSES } from "@/data/pools";
import { formatDate } from "@/lib/format";
import { useCompleteConsultation, useConsultation, useUpdateConsultation } from "@/hooks/use-clinical";
import { useDataStore } from "@/store/data-store";
import { useLiveData } from "@/lib/data-source";
import { useLiveLabTests } from "@/hooks/use-clinic-admin";
import type { ConsultationWithNames } from "@/services/clinical";
import type { Consultation, Vitals } from "@/types";

type Draft = Pick<
  Consultation,
  "chiefComplaint" | "symptoms" | "history" | "allergiesNoted" | "vitals" | "examination" | "diagnosis" | "clinicalNotes" | "treatmentPlan" | "labTestsOrdered" | "followUpDate"
>;

function draftFrom(consultation: Consultation): Draft {
  return {
    chiefComplaint: consultation.chiefComplaint,
    symptoms: consultation.symptoms,
    history: consultation.history ?? "",
    allergiesNoted: consultation.allergiesNoted,
    vitals: consultation.vitals,
    examination: consultation.examination ?? "",
    diagnosis: consultation.diagnosis,
    clinicalNotes: consultation.clinicalNotes,
    treatmentPlan: consultation.treatmentPlan ?? "",
    labTestsOrdered: consultation.labTestsOrdered,
    followUpDate: consultation.followUpDate,
  };
}

interface PatientHeader {
  name: string;
  color: string;
  idLabel: string;
  age?: number;
  gender?: string;
}

function computeBmi(v: Vitals): number | undefined {
  if (!v.weightKg || !v.heightCm) return undefined;
  return Math.round((v.weightKg / (v.heightCm / 100) ** 2) * 10) / 10;
}

export default function ConsultationWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const live = useLiveData();
  const { data: consultation, isLoading, isError, refetch } = useConsultation(id);
  // Demo data keeps the patient in the mock store; the clinic database returns the header fields with the consultation.
  const demoPatient = useDataStore((s) => (!live && consultation ? s.db.patients.find((p) => p.id === consultation.patientId) : undefined));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !consultation || (!live && !demoPatient)) {
    return <ErrorState title="Couldn't load this consultation" onRetry={() => refetch()} />;
  }

  const patient: PatientHeader = live
    ? {
        name: consultation.patientName,
        color: consultation.patientAvatarColor ?? "#64748b",
        idLabel: consultation.patientNumber ?? "",
        age: consultation.patientAge,
        gender: consultation.patientGender,
      }
    : { name: demoPatient!.name, color: demoPatient!.avatarColor, idLabel: demoPatient!.id, age: demoPatient!.age, gender: demoPatient!.gender };

  // Keyed by id: the draft starts from the loaded record once, and later refetches don't overwrite typing in progress.
  return <Workspace key={consultation.id} consultation={consultation} patient={patient} live={live} onChanged={() => refetch()} />;
}

/** Only an in-progress consultation shows the "Order a test..." box (so only then is the list needed). */
const isEditableStatus = (c: ConsultationWithNames) => c.status === "in_progress";

function Workspace({ consultation, patient, live, onChanged }: { consultation: ConsultationWithNames; patient: PatientHeader; live: boolean; onChanged: () => void }) {
  const router = useRouter();
  const updateConsultation = useUpdateConsultation();
  const completeConsultation = useCompleteConsultation();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(consultation));
  const bmi = useMemo(() => computeBmi(draft.vitals), [draft.vitals]);
  // Live: the clinic's lab test master (Clinic → Lab Tests); the built-in list if it can't be loaded.
  const labTests = useLiveLabTests({ enabled: live && isEditableStatus(consultation) });
  const labTestSuggestions = useMemo(
    () => (live && labTests.data ? labTests.data.items.filter((t) => t.status === "active").map((t) => t.name) : [...LAB_REPORT_TYPES]),
    [live, labTests.data]
  );

  // Live: only the assigned doctor may edit or prescribe (the server enforces it; these just hide the controls).
  const isEditable = live ? Boolean(consultation.capabilities?.edit) : consultation.status === "in_progress";
  const canPrescribe = live ? Boolean(consultation.capabilities?.prescribe) : true;
  // ?prescribe=1 (from "New Prescription" on the Prescriptions page) opens the form straight away.
  const prescribeRequested = useSearchParams().get("prescribe") === "1";
  const [rxOpen, setRxOpen] = useState(() => prescribeRequested && canPrescribe);
  const setVital = (key: keyof Vitals, value: string) => {
    const num = value === "" ? undefined : Number(value);
    setDraft((d) => ({ ...d, vitals: { ...d.vitals, [key]: num } }));
  };

  const handleSaveDraft = () => {
    updateConsultation.mutate(
      { id: consultation.id, patch: { ...draft, vitals: { ...draft.vitals, bmi } } },
      { onSuccess: () => toast.success("Consultation notes saved.") }
    );
  };

  const handleComplete = () => {
    completeConsultation.mutate(
      { id: consultation.id, patch: { ...draft, vitals: { ...draft.vitals, bmi } } },
      {
        onSuccess: () => {
          toast.success("Consultation marked as completed.");
          onChanged();
        },
      }
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <PersonAvatar name={patient.name} color={patient.color} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground">{patient.name}</p>
              <StatusBadge status={consultation.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[patient.idLabel, patient.age !== undefined ? `${patient.age} yrs` : undefined, patient.gender, formatDate(consultation.date)].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPrescribe && (
            <Button variant="outline" onClick={() => setRxOpen(true)}>
              <FileSignatureIcon /> Create Prescription
            </Button>
          )}
          {isEditable && (
            <>
              <Button variant="outline" onClick={handleSaveDraft} disabled={updateConsultation.isPending}>
                {updateConsultation.isPending ? "Saving…" : "Save Draft"}
              </Button>
              <Button onClick={handleComplete} disabled={completeConsultation.isPending}>
                <CalendarCheckIcon /> {completeConsultation.isPending ? "Completing…" : "Complete Consultation"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* The AI assistant isn't connected to clinic data (later phase), so it's demo-only. */}
      {isEditable && !live && <AINotesAssistant onAccept={(d) => setDraft((prev) => ({ ...prev, chiefComplaint: d.chiefComplaint, symptoms: d.symptoms, history: d.history, vitals: { ...prev.vitals, temperatureF: d.temperatureF ?? prev.vitals.temperatureF } }))} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Chief Complaint</CardTitle></CardHeader>
            <CardContent>
              <Input
                value={draft.chiefComplaint}
                onChange={(e) => setDraft((d) => ({ ...d, chiefComplaint: e.target.value }))}
                disabled={!isEditable}
                placeholder="e.g. Fever for 3 days"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Symptoms</CardTitle></CardHeader>
            <CardContent>
              {isEditable ? (
                <TagInput value={draft.symptoms} onChange={(v) => setDraft((d) => ({ ...d, symptoms: v }))} suggestions={[...SYMPTOMS]} placeholder="Add a symptom..." />
              ) : (
                <div className="flex flex-wrap gap-1.5">{draft.symptoms.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Medical History &amp; Allergies</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={draft.history}
                onChange={(e) => setDraft((d) => ({ ...d, history: e.target.value }))}
                disabled={!isEditable}
                placeholder="Relevant medical history..."
                rows={2}
              />
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Allergies</p>
                {isEditable ? (
                  <TagInput value={draft.allergiesNoted} onChange={(v) => setDraft((d) => ({ ...d, allergiesNoted: v }))} placeholder="Add an allergy..." />
                ) : (
                  <div className="flex flex-wrap gap-1.5">{draft.allergiesNoted.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vitals</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { key: "temperatureF", label: "Temp (°F)" },
                { key: "bpSystolic", label: "BP Sys" },
                { key: "bpDiastolic", label: "BP Dia" },
                { key: "heartRate", label: "Heart rate" },
                { key: "spo2", label: "SpO2 (%)" },
                { key: "weightKg", label: "Weight (kg)" },
                { key: "heightCm", label: "Height (cm)" },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    type="number"
                    value={draft.vitals[key as keyof Vitals] ?? ""}
                    onChange={(e) => setVital(key as keyof Vitals, e.target.value)}
                    disabled={!isEditable}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">BMI</Label>
                <Input value={bmi ?? "—"} disabled />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Examination</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={draft.examination} onChange={(e) => setDraft((d) => ({ ...d, examination: e.target.value }))} disabled={!isEditable} rows={2} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Diagnosis</CardTitle></CardHeader>
            <CardContent>
              {isEditable ? (
                <TagInput value={draft.diagnosis} onChange={(v) => setDraft((d) => ({ ...d, diagnosis: v }))} suggestions={[...DIAGNOSES]} placeholder="Add a diagnosis..." />
              ) : (
                <div className="flex flex-wrap gap-1.5">{draft.diagnosis.map((dg) => <Badge key={dg} variant="secondary">{dg}</Badge>)}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Clinical Notes</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={draft.clinicalNotes} onChange={(e) => setDraft((d) => ({ ...d, clinicalNotes: e.target.value }))} disabled={!isEditable} rows={4} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Treatment Plan</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={draft.treatmentPlan} onChange={(e) => setDraft((d) => ({ ...d, treatmentPlan: e.target.value }))} disabled={!isEditable} rows={2} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><FlaskConicalIcon className="h-4 w-4" /> Lab Tests</CardTitle></CardHeader>
            <CardContent>
              {isEditable ? (
                <TagInput value={draft.labTestsOrdered} onChange={(v) => setDraft((d) => ({ ...d, labTestsOrdered: v }))} suggestions={labTestSuggestions} placeholder="Order a test..." />
              ) : (
                <div className="flex flex-wrap gap-1.5">{draft.labTestsOrdered.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
              )}
              {/* Live: results for the SAVED ordered tests (lab reports, P6.2). */}
              {live && <ConsultationLabResults consultationId={consultation.id} patientId={consultation.patientId} tests={consultation.labTestsOrdered} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Follow-up</CardTitle></CardHeader>
            <CardContent>
              <Input
                type="date"
                value={draft.followUpDate ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, followUpDate: e.target.value || undefined }))}
                disabled={!isEditable}
              />
            </CardContent>
          </Card>

          {consultation.prescriptionId && (
            <Card>
              <CardHeader><CardTitle>Prescription</CardTitle></CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => router.push(`/prescriptions/${consultation.prescriptionId}`)}>
                  View prescription
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <PrescriptionBuilderDialog
        open={rxOpen}
        onOpenChange={setRxOpen}
        patientId={consultation.patientId}
        doctorId={consultation.doctorId}
        consultationId={consultation.id}
        onCreated={onChanged}
      />
    </div>
  );
}
