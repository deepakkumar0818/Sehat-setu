"use client";

import { useState } from "react";
import { ChevronDownIcon, ClipboardListIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api-client";
import { formatPhone } from "@/lib/phone";
import { usePatientReported } from "@/hooks/use-patient-reported";
import { ALLERGY_STATUS_LABEL, APP_TIME_ZONE, GENDERS, ONSETS, SEVERITIES, labelOf, type PatientReportedView } from "@/lib/patient-intake";

// P6.5: what the PATIENT told the clinic through portal onboarding — read-only,
// for staff with medical-record permission (the API answers 403/404 for
// everyone else, including receptionists, and the card then stays hidden).
// Clearly separated from clinician-confirmed records: nothing here is a
// diagnosis, and nothing here changes the patient record or clinical notes.

const when = new Intl.DateTimeFormat("en-IN", { timeZone: APP_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const day = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", dateStyle: "medium" });
const at = (iso: string) => when.format(new Date(iso));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
const none = <span className="text-muted-foreground">Not provided</span>;

export function PatientReportedCard({ patientId }: { patientId: string }) {
  const q = usePatientReported(patientId);
  const [open, setOpen] = useState(false);

  if (q.error instanceof ApiRequestError && [403, 404, 503].includes(q.error.status)) return null;
  if (q.isLoading) return null;
  if (q.isError || !q.data) return <p className="rounded-lg border p-3 text-sm text-muted-foreground">Couldn&apos;t load patient-reported information.</p>;
  const { profile, symptomReports } = q.data;
  if (!profile && symptomReports.length === 0) return null;

  return (
    <section aria-label="Patient-reported health information" className="rounded-lg border" data-testid="patient-reported">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ClipboardListIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">Patient-reported health information</p>
              <Badge variant="outline">Patient-reported · not clinician-confirmed</Badge>
            </div>
            <p className="text-muted-foreground">
              {profile
                ? `${profile.completedAt ? "Onboarding completed" : "Onboarding in progress"} · last updated ${at(profile.updatedAt)}`
                : "No onboarding answers yet"}
              {symptomReports.length ? ` · ${symptomReports.length} symptom questionnaire${symptomReports.length > 1 ? "s" : ""}` : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`patient-reported-${patientId}`} className="shrink-0">
          {open ? "Hide" : "Show"}
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </Button>
      </div>
      {open && <Details id={`patient-reported-${patientId}`} view={q.data} />}
    </section>
  );
}

function Details({ id, view: { profile, symptomReports } }: { id: string; view: PatientReportedView }) {
  return (
    <div id={id} className="space-y-5 border-t p-4 text-sm">
      <p className="rounded-md bg-muted/60 px-3 py-2 text-muted-foreground">
        Entered by the patient in the portal. Verify before relying on it clinically; confirmed allergies, diagnoses and medicines belong in the clinical record.
      </p>
      {profile && (
        <>
          <div className="space-y-2">
            <h3 className="font-medium text-foreground">Medical history</h3>
            <dl className="space-y-1.5">
              <Row label="Allergies">
                {ALLERGY_STATUS_LABEL[profile.allergyStatus]}
                {profile.allergies.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {profile.allergies.map((a, i) => (
                      <li key={i}>
                        {a.substance}
                        {a.reaction ? ` — ${a.reaction}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              <Row label="Current medicines">
                {profile.medications.length ? (
                  <ul className="list-disc pl-5">
                    {profile.medications.map((m, i) => (
                      <li key={i}>{[m.name, m.dose, m.frequency].filter(Boolean).join(" · ")}</li>
                    ))}
                  </ul>
                ) : (
                  none
                )}
              </Row>
              <Row label="Conditions">{profile.conditions.length ? profile.conditions.join(", ") : none}</Row>
              <Row label="Surgeries / history">{profile.pastSurgeries ? <span className="whitespace-pre-wrap">{profile.pastSurgeries}</span> : none}</Row>
              <Row label="Family history">{profile.familyHistory ? <span className="whitespace-pre-wrap">{profile.familyHistory}</span> : none}</Row>
            </dl>
            {!profile.medicalReviewedAt && <p className="text-xs text-muted-foreground">The patient hasn&apos;t reached the medical-history step yet.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-foreground">Personal details (as reported)</h3>
            <dl className="space-y-1.5">
              <Row label="Legal name">{profile.legalName}</Row>
              <Row label="Date of birth">{day.format(new Date(`${profile.dateOfBirth}T00:00:00Z`))}</Row>
              <Row label="Gender">{labelOf(GENDERS, profile.gender) ?? none}</Row>
              <Row label="Phone">{formatPhone(profile.phone)}</Row>
              <Row label="Address">{[profile.addressLine, profile.city, profile.state, profile.postalCode].filter(Boolean).join(", ")}</Row>
              <Row label="Emergency contact">
                {profile.emergencyContactName
                  ? `${profile.emergencyContactName}${profile.emergencyContactRelationship ? ` (${profile.emergencyContactRelationship})` : ""} · ${formatPhone(profile.emergencyContactPhone)}`
                  : none}
              </Row>
            </dl>
            <p className="text-xs text-muted-foreground">These may differ from the clinic&apos;s record, which onboarding never changes.</p>
          </div>
        </>
      )}
      <div className="space-y-2">
        <h3 className="font-medium text-foreground">Symptom questionnaires</h3>
        {symptomReports.length === 0 ? (
          <p className="text-muted-foreground">None sent.</p>
        ) : (
          <ul className="space-y-3">
            {symptomReports.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Sent {at(r.createdAt)}
                  {r.appointmentLinked ? (r.appointmentAt ? ` · for the appointment on ${at(r.appointmentAt)}` : " · linked to an appointment") : " · not linked to an appointment"}
                </p>
                <p className="mt-1 font-medium text-foreground">{r.reason}</p>
                <p className="whitespace-pre-wrap text-foreground">{r.symptoms}</p>
                <p className="mt-1 text-muted-foreground">
                  Started: {labelOf(ONSETS, r.onset)}
                  {r.severity ? ` · Severity: ${labelOf(SEVERITIES, r.severity)}` : ""}
                </p>
                {r.notes && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
