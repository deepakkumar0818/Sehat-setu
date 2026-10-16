"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PhoneInput } from "@/components/shared/phone-input";
import { OnboardingContext } from "@/components/portal/health-profile-card";
import { appointmentWhen } from "@/lib/patient-intake";
import { OTHER_COUNTRY, PHONE_COUNTRIES, phoneFromParts, phoneParts } from "@/lib/phone";
import {
  ALLERGY_STATUSES,
  GENDERS,
  INTAKE_STEPS,
  ONSETS,
  SEVERITIES,
  fieldErrors,
  medicalSchema,
  personalSchema,
  resumeStep,
  shouldAutoOpen,
  symptomSchema,
  todayInAppZone,
  type AllergyStatus,
  type IntakeState,
  type IntakeStep,
} from "@/lib/patient-intake";
import {
  completeIntakeAction,
  saveIntakeMedicalAction,
  saveIntakePersonalAction,
  skipIntakeMedicalAction,
  submitIntakeSymptomsAction,
  type IntakeActionResult,
} from "@/app/(portal)/intake-actions";

// First-login onboarding (P6.5): a three-step dialog that opens by itself in
// the patient portal while the SERVER says the profile is incomplete. Each
// step is saved by an authenticated Server Action before moving on, so an
// interrupted session resumes where it stopped. "Finish later" only postpones
// the dialog for this browser session (sessionStorage); it never decides
// completeness. Nothing here links a record or changes the clinic's data.

const DISMISSED_KEY = "sehat:intake-dismissed";
const NO_APPOINTMENT = "none";
const NO_GENDER = "unspecified";

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // storage unavailable: the dialog may simply open again on the next page load
  }
}

type Available = Extract<IntakeState, { available: true }>;

const noSubscription = () => () => {};

export function PatientOnboardingProvider({ initial, children }: { initial: IntakeState; children: React.ReactNode }) {
  const [state, setState] = useState<IntakeState>(initial);
  // A newer server snapshot (router.refresh after a booking or a save elsewhere) replaces the local one.
  const [snapshot, setSnapshot] = useState(initial);
  if (initial !== snapshot) {
    setSnapshot(initial);
    setState(initial);
  }
  // "Finish later" earlier in this browser session. The server snapshot is
  // "dismissed", so nothing opens during server rendering or hydration.
  const dismissed = useSyncExternalStore(noSubscription, readDismissed, () => true);
  // Closed (or finished) since this page loaded.
  const [closed, setClosed] = useState(false);
  // Opened from the portal (Continue / Review or update). Each opening gets a
  // fresh form and a fresh symptom request id (the key).
  // `section`: edit just that step from My Health Profile (save closes; no wizard, no completion step).
  const [manual, setManual] = useState<{ step: IntakeStep; session: number; section: boolean } | null>(null);

  const autoOpen = !closed && shouldAutoOpen(initial, dismissed);
  const startStep: IntakeStep = manual?.step ?? (initial.available ? resumeStep(initial.progress) : 1);

  const openAt = useCallback(
    (step?: IntakeStep, opts?: { section?: boolean }) => {
      if (!state.available) return;
      setManual((m) => ({ step: step ?? (state.completed ? 1 : resumeStep(state.progress)), session: (m?.session ?? 0) + 1, section: Boolean(opts?.section && step) }));
    },
    [state]
  );

  const value = useMemo(() => (state.available ? { state, openAt } : null), [state, openAt]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {state.available && (manual !== null || autoOpen) && (
        <OnboardingDialog
          key={manual?.session ?? 0}
          state={state}
          startStep={startStep}
          section={manual?.section ?? false}
          onStateChange={setState}
          onClose={(finished) => {
            if (!finished) writeDismissed();
            setManual(null);
            setClosed(true);
          }}
        />
      )}
    </OnboardingContext.Provider>
  );
}

// --- Form state --------------------------------------------------------------------

type PhoneParts = { country: string; otherDial: string; national: string };
const dialOf = (p: PhoneParts) => (p.country === OTHER_COUNTRY ? p.otherDial : (PHONE_COUNTRIES.find((c) => c.iso === p.country)?.dial ?? ""));

function personalForm(state: Available) {
  const p = state.personal;
  return {
    legalName: p.legalName ?? "",
    dateOfBirth: p.dateOfBirth ?? "",
    gender: p.gender ?? NO_GENDER,
    phone: phoneParts(p.phone),
    addressLine: p.addressLine ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postalCode: p.postalCode ?? "",
    emergencyContactName: p.emergencyContactName ?? "",
    emergencyContactRelationship: p.emergencyContactRelationship ?? "",
    emergencyPhone: phoneParts(p.emergencyContactPhone),
  };
}
type PersonalForm = ReturnType<typeof personalForm>;

function medicalForm(state: Available) {
  const m = state.medical;
  return {
    allergyStatus: (m?.allergyStatus ?? "NOT_ANSWERED") as AllergyStatus,
    allergies: m?.allergies.length ? m.allergies.map((a) => ({ substance: a.substance, reaction: a.reaction ?? "" })) : [{ substance: "", reaction: "" }],
    medications: m?.medications.map((x) => ({ name: x.name, dose: x.dose ?? "", frequency: x.frequency ?? "" })) ?? [],
    conditions: m?.conditions ?? [],
    pastSurgeries: m?.pastSurgeries ?? "",
    familyHistory: m?.familyHistory ?? "",
  };
}
type MedicalForm = ReturnType<typeof medicalForm>;

const emptySymptoms = () => ({ appointmentId: NO_APPOINTMENT, reason: "", symptoms: "", onset: "", severity: "", notes: "" });
type SymptomForm = ReturnType<typeof emptySymptoms>;

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
}

// --- Dialog ---------------------------------------------------------------------------

function OnboardingDialog({
  state,
  startStep,
  section = false,
  onStateChange,
  onClose,
}: {
  state: Available;
  startStep: IntakeStep;
  /** Edit only `startStep` (from My Health Profile): Save closes the dialog. */
  section?: boolean;
  onStateChange: (s: IntakeState) => void;
  onClose: (finished: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<IntakeStep>(startStep);
  const [personal, setPersonal] = useState<PersonalForm>(() => personalForm(state));
  const [medical, setMedical] = useState<MedicalForm>(() => medicalForm(state));
  const [symptoms, setSymptoms] = useState<SymptomForm>(emptySymptoms);
  const [saved, setSaved] = useState(() => ({ personal: JSON.stringify(personalForm(state)), medical: JSON.stringify(medicalForm(state)), symptoms: JSON.stringify(emptySymptoms()) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const busyRef = useRef(false);
  const requestId = useRef(newRequestId());
  const symptomsSent = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const dirty =
    JSON.stringify(personal) !== saved.personal || JSON.stringify(medical) !== saved.medical || JSON.stringify(symptoms) !== saved.symptoms;
  const prefilledFromClinic = !state.progress.personalSaved && Boolean(state.personal.legalName);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose(false);
  }

  /** Runs one Server Action at a time (a second click while saving does nothing). */
  async function submit(action: () => Promise<IntakeActionResult>, onSuccess: (r: Extract<IntakeActionResult, { ok: true }>) => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    setSignedOut(false);
    try {
      const r = await action();
      if (r.ok) {
        onStateChange(r.state);
        setErrors({});
        onSuccess(r);
        return;
      }
      if (r.error === "signed_out") setSignedOut(true);
      setErrors(r.fields ?? {});
      setFormError(r.message);
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again — your earlier steps are kept.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Step 1 ------------------------------------------------------------------------------
  function personalPayload(): { ok: true; value: unknown } | { ok: false; errors: Record<string, string> } {
    const errs: Record<string, string> = {};
    const phone = phoneFromParts(dialOf(personal.phone), personal.phone.national);
    if (!phone.ok) errs.phone = phone.error;
    let emergencyPhone = "";
    if (personal.emergencyPhone.national.trim()) {
      const ep = phoneFromParts(dialOf(personal.emergencyPhone), personal.emergencyPhone.national);
      if (ep.ok) emergencyPhone = ep.e164;
      else errs.emergencyContactPhone = ep.error;
    }
    const value = {
      legalName: personal.legalName,
      dateOfBirth: personal.dateOfBirth,
      gender: personal.gender === NO_GENDER ? null : personal.gender,
      phone: phone.ok ? phone.e164 : "",
      addressLine: personal.addressLine,
      city: personal.city,
      state: personal.state,
      postalCode: personal.postalCode,
      emergencyContactName: personal.emergencyContactName,
      emergencyContactRelationship: personal.emergencyContactRelationship,
      emergencyContactPhone: emergencyPhone,
    };
    const parsed = personalSchema().safeParse(value);
    if (!parsed.success) Object.assign(errs, Object.fromEntries(Object.entries(fieldErrors(parsed.error)).filter(([k]) => !errs[k])));
    return Object.keys(errs).length ? { ok: false, errors: errs } : { ok: true, value };
  }

  function savePersonal() {
    const p = personalPayload();
    if (!p.ok) {
      setErrors(p.errors);
      setFormError("Please check the highlighted answers.");
      return;
    }
    void submit(() => saveIntakePersonalAction(p.value), () => {
      setSaved((s) => ({ ...s, personal: JSON.stringify(personal) }));
      if (section) return sectionSaved("Personal details saved.");
      setStep(2);
    });
  }

  // Step 2 ------------------------------------------------------------------------------
  function medicalPayload() {
    const filled = (o: Record<string, string>) => Object.values(o).some((v) => v.trim() !== "");
    return {
      allergyStatus: medical.allergyStatus,
      allergies: medical.allergyStatus === "HAS_ALLERGIES" ? medical.allergies.filter(filled) : [],
      medications: medical.medications.filter(filled),
      conditions: medical.conditions.filter((c) => c.trim() !== ""),
      pastSurgeries: medical.pastSurgeries,
      familyHistory: medical.familyHistory,
    };
  }

  function saveMedical() {
    const value = medicalPayload();
    const parsed = medicalSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError("Please check the highlighted answers.");
      return;
    }
    void submit(() => saveIntakeMedicalAction(value), () => {
      setSaved((s) => ({ ...s, medical: JSON.stringify(medical) }));
      if (section) return sectionSaved("Medical history saved.");
      setStep(3);
    });
  }

  function skipMedical() {
    void submit(() => skipIntakeMedicalAction(), () => {
      setMedical(medicalForm(state));
      setStep(3);
    });
  }

  // Step 3 ------------------------------------------------------------------------------
  const symptomsEntered = Boolean(symptoms.reason.trim() || symptoms.symptoms.trim() || symptoms.onset || symptoms.severity || symptoms.notes.trim());

  function finished() {
    toast.success("Thank you — your health profile is saved.");
    onClose(true);
    // Stay on the current page (e.g. My Health Profile); just reload the server data.
    router.refresh();
  }

  function sectionSaved(message: string) {
    toast.success(message);
    onClose(true);
    router.refresh();
  }

  async function finish(withSymptoms: boolean) {
    if (withSymptoms && !symptomsSent.current) {
      const value = {
        requestId: requestId.current,
        appointmentId: symptoms.appointmentId === NO_APPOINTMENT ? null : symptoms.appointmentId,
        reason: symptoms.reason,
        symptoms: symptoms.symptoms,
        onset: symptoms.onset,
        severity: symptoms.severity || null,
        notes: symptoms.notes,
      };
      const parsed = symptomSchema.safeParse(value);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        setFormError("Please check the highlighted answers, or choose “Skip and finish”.");
        return;
      }
      let sent = false;
      await submit(() => submitIntakeSymptomsAction(value), () => {
        sent = true;
      });
      if (!sent) return;
      // Saved: a retry of "finish" must not send it again (the request id would return the same report anyway).
      symptomsSent.current = true;
      setSaved((s) => ({ ...s, symptoms: JSON.stringify(symptoms) }));
    }
    if (section) {
      if (withSymptoms) sectionSaved("Sent to your clinic.");
      return;
    }
    await submit(() => completeIntakeAction(), finished);
  }

  // Render --------------------------------------------------------------------------------
  const err = (key: string) => errors[key];
  const describe = (key: string) => (errors[key] ? `${key}-error` : undefined);
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`${name}-error`} className="text-xs text-danger">
        {errors[name]}
      </p>
    ) : null;
  const title = INTAKE_STEPS[step - 1].title;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && requestClose()}>
        <DialogContent
          className="flex max-h-[92svh] flex-col gap-0 p-0 sm:max-w-2xl"
          onInteractOutside={(e) => e.preventDefault()}
          data-testid="patient-onboarding"
        >
          <DialogHeader className="space-y-3 border-b px-5 pb-4 pt-5 text-left">
            <DialogTitle>{section ? (step === 3 ? "Tell your clinic how you feel" : `Edit ${INTAKE_STEPS[step - 1].title.toLowerCase()}`) : state.completed ? "Update your health profile" : "Welcome — let's set up your health profile"}</DialogTitle>
            <DialogDescription>Your answers go to your clinic as information you reported. They don&apos;t change your clinic&apos;s records and aren&apos;t a diagnosis.</DialogDescription>
            <div hidden={section}>
              <ol className="mb-2 flex gap-2 text-xs" aria-label="Progress">
                {INTAKE_STEPS.map((s) => (
                  <li
                    key={s.step}
                    aria-current={s.step === step ? "step" : undefined}
                    className={s.step === step ? "font-semibold text-primary" : s.step < step ? "text-foreground" : "text-muted-foreground"}
                  >
                    {s.step}. {s.title}
                  </li>
                ))}
              </ol>
              <Progress value={(step / 3) * 100} aria-label={`Step ${step} of 3`} />
            </div>
          </DialogHeader>

          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 1) savePersonal();
              else if (step === 2) saveMedical();
              else void finish(symptomsEntered);
            }}
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-foreground outline-none">
                {section ? title : `Step ${step} of 3: ${title}`}
              </h2>

              {step === 1 && (
                <fieldset disabled={busy} className="space-y-4">
                  {prefilledFromClinic && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      We&apos;ve started with the details your clinic has on file. Please check and correct them.
                    </p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="legalName">Full legal name</Label>
                      <Input id="legalName" autoComplete="name" value={personal.legalName} onChange={(e) => setPersonal({ ...personal, legalName: e.target.value })} aria-invalid={Boolean(err("legalName"))} aria-describedby={describe("legalName")} />
                      {fieldError("legalName")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dateOfBirth">Date of birth</Label>
                      <Input id="dateOfBirth" type="date" min="1900-01-01" max={todayInAppZone()} autoComplete="bday" value={personal.dateOfBirth} onChange={(e) => setPersonal({ ...personal, dateOfBirth: e.target.value })} aria-invalid={Boolean(err("dateOfBirth"))} aria-describedby={describe("dateOfBirth")} />
                      {fieldError("dateOfBirth")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="gender">
                        Gender <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Select value={personal.gender} onValueChange={(v) => setPersonal({ ...personal, gender: v })}>
                        <SelectTrigger id="gender">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_GENDER}>Prefer not to say</SelectItem>
                          {GENDERS.map((g) => (
                            <SelectItem key={g.value} value={g.value}>
                              {g.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="phone">Phone number</Label>
                      <PhoneInput
                        id="phone"
                        country={personal.phone.country}
                        onCountryChange={(country) => setPersonal({ ...personal, phone: { ...personal.phone, country } })}
                        otherDial={personal.phone.otherDial}
                        onOtherDialChange={(otherDial) => setPersonal({ ...personal, phone: { ...personal.phone, otherDial } })}
                        national={personal.phone.national}
                        onNationalChange={(national) => setPersonal({ ...personal, phone: { ...personal.phone, national } })}
                        error={err("phone")}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="addressLine">Address</Label>
                      <Input id="addressLine" autoComplete="street-address" value={personal.addressLine} onChange={(e) => setPersonal({ ...personal, addressLine: e.target.value })} aria-invalid={Boolean(err("addressLine"))} aria-describedby={describe("addressLine")} />
                      {fieldError("addressLine")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="city">City or town</Label>
                      <Input id="city" autoComplete="address-level2" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} aria-invalid={Boolean(err("city"))} aria-describedby={describe("city")} />
                      {fieldError("city")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="state">
                        State <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input id="state" autoComplete="address-level1" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} aria-invalid={Boolean(err("state"))} aria-describedby={describe("state")} />
                      {fieldError("state")}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="postalCode">
                        Postal code <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input id="postalCode" autoComplete="postal-code" inputMode="text" value={personal.postalCode} onChange={(e) => setPersonal({ ...personal, postalCode: e.target.value })} aria-invalid={Boolean(err("postalCode"))} aria-describedby={describe("postalCode")} />
                      {fieldError("postalCode")}
                    </div>
                  </div>

                  <fieldset className="space-y-3 rounded-lg border p-4">
                    <legend className="px-1 text-sm font-medium text-foreground">
                      Emergency contact <span className="font-normal text-muted-foreground">(optional)</span>
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="emergencyContactName">Name</Label>
                        <Input id="emergencyContactName" value={personal.emergencyContactName} onChange={(e) => setPersonal({ ...personal, emergencyContactName: e.target.value })} aria-invalid={Boolean(err("emergencyContactName"))} aria-describedby={describe("emergencyContactName")} />
                        {fieldError("emergencyContactName")}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="emergencyContactRelationship">Relationship</Label>
                        <Input id="emergencyContactRelationship" placeholder="e.g. Spouse, Parent" value={personal.emergencyContactRelationship} onChange={(e) => setPersonal({ ...personal, emergencyContactRelationship: e.target.value })} aria-invalid={Boolean(err("emergencyContactRelationship"))} aria-describedby={describe("emergencyContactRelationship")} />
                        {fieldError("emergencyContactRelationship")}
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="emergencyContactPhone">Phone number</Label>
                        <PhoneInput
                          id="emergencyContactPhone"
                          country={personal.emergencyPhone.country}
                          onCountryChange={(country) => setPersonal({ ...personal, emergencyPhone: { ...personal.emergencyPhone, country } })}
                          otherDial={personal.emergencyPhone.otherDial}
                          onOtherDialChange={(otherDial) => setPersonal({ ...personal, emergencyPhone: { ...personal.emergencyPhone, otherDial } })}
                          national={personal.emergencyPhone.national}
                          onNationalChange={(national) => setPersonal({ ...personal, emergencyPhone: { ...personal.emergencyPhone, national } })}
                          error={err("emergencyContactPhone")}
                        />
                      </div>
                    </div>
                  </fieldset>
                </fieldset>
              )}

              {step === 2 && (
                <fieldset disabled={busy} className="space-y-5">
                  <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                    Everything on this step is optional. Your doctor will review what you share — it isn&apos;t treated as a diagnosis. You can update it later.
                  </p>

                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium text-foreground">Allergies</legend>
                    <RadioGroup
                      value={medical.allergyStatus === "NOT_ANSWERED" ? "" : medical.allergyStatus}
                      onValueChange={(v) => setMedical({ ...medical, allergyStatus: v as AllergyStatus })}
                      aria-describedby={describe("allergyStatus")}
                      className="gap-2"
                    >
                      {ALLERGY_STATUSES.map((s) => (
                        <div key={s.value} className="flex items-center gap-2">
                          <RadioGroupItem id={`allergy-${s.value}`} value={s.value} />
                          <Label htmlFor={`allergy-${s.value}`} className="font-normal">
                            {s.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                    {fieldError("allergyStatus")}
                    {medical.allergyStatus === "HAS_ALLERGIES" && (
                      <div className="space-y-2">
                        {medical.allergies.map((a, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                            <Input aria-label={`Allergy ${i + 1}: substance`} placeholder="Allergic to (e.g. Penicillin)" value={a.substance} onChange={(e) => setMedical({ ...medical, allergies: medical.allergies.map((x, j) => (j === i ? { ...x, substance: e.target.value } : x)) })} />
                            <Input aria-label={`Allergy ${i + 1}: reaction (optional)`} placeholder="Reaction (optional)" value={a.reaction} onChange={(e) => setMedical({ ...medical, allergies: medical.allergies.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)) })} />
                            <Button type="button" variant="ghost" size="icon" aria-label={`Remove allergy ${i + 1}`} onClick={() => setMedical({ ...medical, allergies: medical.allergies.filter((_, j) => j !== i) })}>
                              <Trash2Icon className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        {fieldError("allergies")}
                        <Button type="button" variant="outline" size="sm" onClick={() => setMedical({ ...medical, allergies: [...medical.allergies, { substance: "", reaction: "" }] })}>
                          <PlusIcon className="h-4 w-4" /> Add allergy
                        </Button>
                      </div>
                    )}
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">
                      Current medicines <span className="font-normal text-muted-foreground">(optional)</span>
                    </legend>
                    {medical.medications.map((m, i) => (
                      <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-start gap-2">
                        <Input aria-label={`Medicine ${i + 1}: name`} placeholder="Name" value={m.name} onChange={(e) => setMedical({ ...medical, medications: medical.medications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                        <Input aria-label={`Medicine ${i + 1}: dose (optional)`} placeholder="Dose" value={m.dose} onChange={(e) => setMedical({ ...medical, medications: medical.medications.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)) })} />
                        <Input aria-label={`Medicine ${i + 1}: how often (optional)`} placeholder="How often" value={m.frequency} onChange={(e) => setMedical({ ...medical, medications: medical.medications.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)) })} />
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove medicine ${i + 1}`} onClick={() => setMedical({ ...medical, medications: medical.medications.filter((_, j) => j !== i) })}>
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => setMedical({ ...medical, medications: [...medical.medications, { name: "", dose: "", frequency: "" }] })}>
                      <PlusIcon className="h-4 w-4" /> Add medicine
                    </Button>
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">
                      Existing medical conditions <span className="font-normal text-muted-foreground">(optional)</span>
                    </legend>
                    {medical.conditions.map((c, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto] gap-2">
                        <Input aria-label={`Condition ${i + 1}`} placeholder="e.g. Asthma" value={c} onChange={(e) => setMedical({ ...medical, conditions: medical.conditions.map((x, j) => (j === i ? e.target.value : x)) })} />
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove condition ${i + 1}`} onClick={() => setMedical({ ...medical, conditions: medical.conditions.filter((_, j) => j !== i) })}>
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => setMedical({ ...medical, conditions: [...medical.conditions, ""] })}>
                      <PlusIcon className="h-4 w-4" /> Add condition
                    </Button>
                  </fieldset>

                  <div className="space-y-1.5">
                    <Label htmlFor="pastSurgeries">
                      Previous surgeries and other relevant history <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea id="pastSurgeries" rows={3} value={medical.pastSurgeries} onChange={(e) => setMedical({ ...medical, pastSurgeries: e.target.value })} aria-invalid={Boolean(err("pastSurgeries"))} aria-describedby={describe("pastSurgeries")} />
                    {fieldError("pastSurgeries")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="familyHistory">
                      Family history <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea id="familyHistory" rows={2} value={medical.familyHistory} onChange={(e) => setMedical({ ...medical, familyHistory: e.target.value })} aria-invalid={Boolean(err("familyHistory"))} aria-describedby={describe("familyHistory")} />
                    {fieldError("familyHistory")}
                  </div>
                </fieldset>
              )}

              {step === 3 && (
                <fieldset disabled={busy} className="space-y-4">
                  <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground" role="note">
                    This is optional and helps your doctor prepare — it isn&apos;t a diagnosis. <strong>In an emergency, call your local emergency number (112 in India) or go to the nearest emergency department.</strong>
                  </p>
                  {state.recentSymptomReports > 0 && (
                    <p className="text-sm text-muted-foreground">
                      You&apos;ve already sent {state.recentSymptomReports === 1 ? "a symptom update" : `${state.recentSymptomReports} symptom updates`} recently. Saving adds a new one; earlier answers are kept.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="appointmentId">For which visit?</Label>
                    {state.appointments.length ? (
                      <Select value={symptoms.appointmentId} onValueChange={(v) => setSymptoms({ ...symptoms, appointmentId: v })}>
                        <SelectTrigger id="appointmentId">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_APPOINTMENT}>Not for a specific appointment</SelectItem>
                          {state.appointments.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {appointmentWhen(a.startsAt)}
                              {a.doctorName ? ` · ${a.doctorName}` : ""}
                              {a.branchName ? ` · ${a.branchName}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">You have no upcoming appointments. Your answers will be kept for your clinic to see at your next visit.</p>
                    )}
                    {fieldError("appointmentId")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reason">Main reason for seeking care</Label>
                    <Input id="reason" value={symptoms.reason} onChange={(e) => setSymptoms({ ...symptoms, reason: e.target.value })} aria-invalid={Boolean(err("reason"))} aria-describedby={describe("reason")} />
                    {fieldError("reason")}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="symptoms">Current symptoms</Label>
                    <Textarea id="symptoms" rows={3} value={symptoms.symptoms} onChange={(e) => setSymptoms({ ...symptoms, symptoms: e.target.value })} aria-invalid={Boolean(err("symptoms"))} aria-describedby={describe("symptoms")} />
                    {fieldError("symptoms")}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="onset">When did they start?</Label>
                      <Select value={symptoms.onset} onValueChange={(v) => setSymptoms({ ...symptoms, onset: v })}>
                        <SelectTrigger id="onset" aria-invalid={Boolean(err("onset"))} aria-describedby={describe("onset")}>
                          <SelectValue placeholder="Choose…" />
                        </SelectTrigger>
                        <SelectContent>
                          {ONSETS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldError("onset")}
                    </div>
                    <fieldset className="space-y-1.5">
                      <legend className="text-sm font-medium text-foreground">
                        Severity <span className="font-normal text-muted-foreground">(optional)</span>
                      </legend>
                      <RadioGroup value={symptoms.severity} onValueChange={(v) => setSymptoms({ ...symptoms, severity: v })} className="flex gap-4">
                        {SEVERITIES.map((s) => (
                          <div key={s.value} className="flex items-center gap-1.5">
                            <RadioGroupItem id={`severity-${s.value}`} value={s.value} />
                            <Label htmlFor={`severity-${s.value}`} className="font-normal">
                              {s.label}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </fieldset>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notes">
                      Anything else? <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea id="notes" rows={2} value={symptoms.notes} onChange={(e) => setSymptoms({ ...symptoms, notes: e.target.value })} aria-invalid={Boolean(err("notes"))} aria-describedby={describe("notes")} />
                    {fieldError("notes")}
                  </div>
                  <p className="text-xs text-muted-foreground">You can send updated symptoms before a future visit at any time from your portal home page.</p>
                </fieldset>
              )}

              {formError && (
                <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {formError}
                  {signedOut && (
                    <>
                      {" "}
                      <Link href="/login?reason=expired&next=/portal" className="font-medium underline">
                        Sign in again
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>

            {section ? (
              <div className="flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || (step === 3 && !symptomsEntered)}>
                  {busy && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />}
                  {step === 3 ? "Send to clinic" : "Save changes"}
                </Button>
              </div>
            ) : (
            <div className="flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>
                Finish later
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={() => { setErrors({}); setFormError(null); setStep((step - 1) as IntakeStep); }} disabled={busy}>
                    Back
                  </Button>
                )}
                {step === 2 && (
                  <Button type="button" variant="outline" onClick={skipMedical} disabled={busy}>
                    Skip for now
                  </Button>
                )}
                {step === 3 && (
                  <Button type="button" variant="outline" onClick={() => void finish(false)} disabled={busy}>
                    Skip and finish
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden />}
                  {step === 3 ? (symptomsEntered ? "Save and finish" : "Finish") : "Save and continue"}
                </Button>
              </div>
            </div>
            )}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Answers you&apos;ve already saved are kept. Changes on this step that you haven&apos;t saved will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => onClose(false)}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
