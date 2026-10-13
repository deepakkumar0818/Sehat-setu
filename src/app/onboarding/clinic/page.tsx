"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/shared/logo";
import { OnboardingStepper } from "@/components/onboarding/onboarding-stepper";
import { useOnboardClinic } from "@/hooks/use-tenant-clinics";
import { useSpecialtyCatalog } from "@/hooks/use-specialties";
import { useAuthStore } from "@/store/auth-store";
import type { ClinicType, DoctorAvailabilitySlot } from "@/types";

const CLINIC_TYPES: { value: ClinicType; label: string }[] = [
  { value: "private_clinic", label: "Private Clinic" },
  { value: "multi_specialty", label: "Multi-Specialty Clinic" },
  { value: "hospital", label: "Hospital" },
  { value: "diagnostic_center", label: "Diagnostic Center" },
  { value: "dental_clinic", label: "Dental Clinic" },
  { value: "skin_clinic", label: "Skin Clinic" },
  { value: "eye_clinic", label: "Eye Clinic" },
  { value: "physiotherapy_center", label: "Physiotherapy Center" },
  { value: "mental_health_clinic", label: "Mental Health Clinic" },
  { value: "other", label: "Other" },
];

const WEEKDAYS: DoctorAvailabilitySlot["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface FormState {
  clinic: { name: string; type: ClinicType; email: string; phone: string; website: string; address: string; city: string; state: string; country: string; pincode: string };
  specialtyIds: string[];
  customSpecialtyNames: string[];
  branch: { name: string; code: string; address: string; phone: string; email: string; workingHours: string; timezone: string };
  owner: { name: string; email: string; mobile: string; password: string };
  settings: { appointmentDurationMinutes: number; currency: string; workingDays: DoctorAvailabilitySlot["day"][]; onlineConsultationEnabled: boolean; smsNotificationsEnabled: boolean; emailNotificationsEnabled: boolean };
}

const INITIAL_STATE: FormState = {
  clinic: { name: "", type: "multi_specialty", email: "", phone: "", website: "", address: "", city: "", state: "", country: "India", pincode: "" },
  specialtyIds: [],
  customSpecialtyNames: [],
  branch: { name: "Main Branch", code: "", address: "", phone: "", email: "", workingHours: "9:00 AM - 6:00 PM", timezone: "Asia/Kolkata" },
  owner: { name: "", email: "", mobile: "", password: "" },
  settings: { appointmentDurationMinutes: 30, currency: "INR", workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], onlineConsultationEnabled: true, smsNotificationsEnabled: true, emailNotificationsEnabled: true },
};

export default function ClinicOnboardingPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [customSpecialtyInput, setCustomSpecialtyInput] = useState("");
  const [specialtySearch, setSpecialtySearch] = useState("");
  const { data: filteredCatalog = [] } = useSpecialtyCatalog(specialtySearch);
  const { data: fullCatalog = [] } = useSpecialtyCatalog();
  const onboard = useOnboardClinic();

  const update = <K extends keyof FormState>(key: K, patch: Partial<FormState[K]>) =>
    setForm((f) => ({ ...f, [key]: { ...(f[key] as object), ...patch } }));

  const canProceed = useMemo(() => {
    if (step === 1) return form.clinic.name && form.clinic.email && form.clinic.phone && form.clinic.address && form.clinic.city && form.clinic.state && form.clinic.pincode;
    if (step === 2) return form.specialtyIds.length + form.customSpecialtyNames.length > 0;
    if (step === 3) return form.branch.name && form.branch.address && form.branch.phone;
    if (step === 4) return form.owner.name && form.owner.email && form.owner.mobile && form.owner.password.length >= 4;
    return true;
  }, [step, form]);

  function toggleSpecialty(id: string) {
    setForm((f) => ({
      ...f,
      specialtyIds: f.specialtyIds.includes(id) ? f.specialtyIds.filter((s) => s !== id) : [...f.specialtyIds, id],
    }));
  }

  function addCustomSpecialty() {
    const name = customSpecialtyInput.trim();
    if (!name || form.customSpecialtyNames.includes(name)) return;
    setForm((f) => ({ ...f, customSpecialtyNames: [...f.customSpecialtyNames, name] }));
    setCustomSpecialtyInput("");
  }

  function toggleWorkingDay(day: DoctorAvailabilitySlot["day"]) {
    setForm((f) => ({
      ...f,
      settings: {
        ...f.settings,
        workingDays: f.settings.workingDays.includes(day) ? f.settings.workingDays.filter((d) => d !== day) : [...f.settings.workingDays, day],
      },
    }));
  }

  async function handleCreate() {
    try {
      const result = await onboard.mutateAsync({
        clinic: { ...form.clinic, website: form.clinic.website || undefined },
        specialtyIds: form.specialtyIds,
        customSpecialtyNames: form.customSpecialtyNames,
        branch: { ...form.branch, code: form.branch.code || undefined, email: form.branch.email || undefined },
        owner: form.owner,
        settings: form.settings,
      });
      toast.success(`${result.clinic.name} is ready.`);
      const signedIn = login(form.owner.email, form.owner.password);
      if (signedIn) {
        router.push("/clinic/dashboard");
      } else {
        router.push("/login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the clinic. Please try again.");
    }
  }

  const specialtyName = (id: string) => fullCatalog.find((s) => s.id === id)?.name;

  return (
    <div className="min-h-svh bg-muted/20 py-10">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="flex justify-center">
          <Logo size="md" />
        </div>
        <div className="mt-8 rounded-2xl border bg-card p-6 sm:p-8">
          <OnboardingStepper currentStep={step} />

          <div className="mt-8">
            {step === 1 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Create your clinic</h1>
                <p className="mt-1 text-sm text-muted-foreground">Tell us about your healthcare business.</p>
                <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="clinic-name">Clinic name</Label>
                    <Input id="clinic-name" value={form.clinic.name} onChange={(e) => update("clinic", { name: e.target.value })} placeholder="e.g. ABC Multispeciality Clinic" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clinic type</Label>
                    <Select value={form.clinic.type} onValueChange={(v) => update("clinic", { type: v as ClinicType })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CLINIC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-email">Email</Label>
                    <Input id="clinic-email" type="email" value={form.clinic.email} onChange={(e) => update("clinic", { email: e.target.value })} placeholder="contact@clinic.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-phone">Phone</Label>
                    <Input id="clinic-phone" value={form.clinic.phone} onChange={(e) => update("clinic", { phone: e.target.value })} placeholder="+91 9XXXXXXXXX" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-website">Website (optional)</Label>
                    <Input id="clinic-website" value={form.clinic.website} onChange={(e) => update("clinic", { website: e.target.value })} placeholder="https://" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="clinic-address">Address</Label>
                    <Input id="clinic-address" value={form.clinic.address} onChange={(e) => update("clinic", { address: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-city">City</Label>
                    <Input id="clinic-city" value={form.clinic.city} onChange={(e) => update("clinic", { city: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-state">State</Label>
                    <Input id="clinic-state" value={form.clinic.state} onChange={(e) => update("clinic", { state: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-country">Country</Label>
                    <Input id="clinic-country" value={form.clinic.country} onChange={(e) => update("clinic", { country: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clinic-pincode">Pincode</Label>
                    <Input id="clinic-pincode" value={form.clinic.pincode} onChange={(e) => update("clinic", { pincode: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Select specialties</h1>
                <p className="mt-1 text-sm text-muted-foreground">Choose every specialty your clinic offers. You can change this later.</p>
                <div className="relative mt-4">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={specialtySearch} onChange={(e) => setSpecialtySearch(e.target.value)} placeholder="Search specialties..." className="pl-9" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {filteredCatalog.map((s) => {
                    const active = form.specialtyIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSpecialty(s.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          active ? "border-primary bg-primary/5 text-primary" : "text-foreground hover:bg-muted"
                        }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                          {active && <CheckIcon className="h-2.5 w-2.5" />}
                        </span>
                        <span className="truncate">{s.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 space-y-1.5">
                  <Label>Add a custom specialty</Label>
                  <div className="flex gap-2">
                    <Input
                      value={customSpecialtyInput}
                      onChange={(e) => setCustomSpecialtyInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSpecialty())}
                      placeholder="e.g. Sports Medicine"
                    />
                    <Button type="button" variant="outline" onClick={addCustomSpecialty}><PlusIcon /> Add</Button>
                  </div>
                  {form.customSpecialtyNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.customSpecialtyNames.map((name) => (
                        <span key={name} className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-primary">
                          {name}
                          <button type="button" onClick={() => setForm((f) => ({ ...f, customSpecialtyNames: f.customSpecialtyNames.filter((n) => n !== name) }))}>
                            <XIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Create your first branch</h1>
                <p className="mt-1 text-sm text-muted-foreground">Your clinic's primary location. You can add more branches later.</p>
                <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-name">Branch name</Label>
                    <Input id="branch-name" value={form.branch.name} onChange={(e) => update("branch", { name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-code">Branch code</Label>
                    <Input id="branch-code" value={form.branch.code} onChange={(e) => update("branch", { code: e.target.value })} placeholder="e.g. CHD-001" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="branch-address">Address</Label>
                    <Input id="branch-address" value={form.branch.address} onChange={(e) => update("branch", { address: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-phone">Phone</Label>
                    <Input id="branch-phone" value={form.branch.phone} onChange={(e) => update("branch", { phone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-email">Email (optional)</Label>
                    <Input id="branch-email" value={form.branch.email} onChange={(e) => update("branch", { email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-hours">Working hours</Label>
                    <Input id="branch-hours" value={form.branch.workingHours} onChange={(e) => update("branch", { workingHours: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="branch-tz">Timezone</Label>
                    <Input id="branch-tz" value={form.branch.timezone} onChange={(e) => update("branch", { timezone: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Create the clinic owner account</h1>
                <p className="mt-1 text-sm text-muted-foreground">This account gets full control of the clinic. Role: <span className="font-medium text-foreground">Clinic Owner</span>.</p>
                <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="owner-name">Full name</Label>
                    <Input id="owner-name" value={form.owner.name} onChange={(e) => update("owner", { name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="owner-email">Email</Label>
                    <Input id="owner-email" type="email" value={form.owner.email} onChange={(e) => update("owner", { email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="owner-mobile">Mobile</Label>
                    <Input id="owner-mobile" value={form.owner.mobile} onChange={(e) => update("owner", { mobile: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="owner-password">Password</Label>
                    <Input id="owner-password" type="password" value={form.owner.password} onChange={(e) => update("owner", { password: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {step === 5 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Configure your clinic</h1>
                <p className="mt-1 text-sm text-muted-foreground">Sensible defaults are pre-filled — adjust anything you like.</p>
                <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Appointment duration</Label>
                    <Select value={String(form.settings.appointmentDurationMinutes)} onValueChange={(v) => update("settings", { appointmentDurationMinutes: Number(v) })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="20">20 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="45">45 minutes</SelectItem>
                        <SelectItem value="60">60 minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Currency</Label>
                    <Select value={form.settings.currency} onValueChange={(v) => update("settings", { currency: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INR">INR (₹)</SelectItem>
                        <SelectItem value="USD">USD ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  <Label>Working days</Label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => {
                      const active = form.settings.workingDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleWorkingDay(day)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 space-y-2.5">
                  <label className="flex items-center gap-2.5 rounded-lg border p-3">
                    <Checkbox checked={form.settings.onlineConsultationEnabled} onCheckedChange={(c) => update("settings", { onlineConsultationEnabled: c === true })} />
                    <span className="text-sm text-foreground">Enable online consultation</span>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-lg border p-3">
                    <Checkbox checked={form.settings.smsNotificationsEnabled} onCheckedChange={(c) => update("settings", { smsNotificationsEnabled: c === true })} />
                    <span className="text-sm text-foreground">Enable SMS notifications</span>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-lg border p-3">
                    <Checkbox checked={form.settings.emailNotificationsEnabled} onCheckedChange={(c) => update("settings", { emailNotificationsEnabled: c === true })} />
                    <span className="text-sm text-foreground">Enable email notifications</span>
                  </label>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Payment settings: consultation fees are set per doctor when you add them under Doctors, and payments are collected via the UPI / Card / Net Banking checkout already built into booking.
                </p>
              </div>
            )}

            {step === 6 && (
              <div>
                <h1 className="text-lg font-semibold text-foreground">Review &amp; create</h1>
                <p className="mt-1 text-sm text-muted-foreground">Check everything before creating your clinic.</p>

                <div className="mt-5 space-y-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clinic</p>
                    <p className="mt-1 font-medium text-foreground">{form.clinic.name}</p>
                    <p className="text-sm text-muted-foreground">{CLINIC_TYPES.find((t) => t.value === form.clinic.type)?.label} · {form.clinic.city}, {form.clinic.state}</p>
                    <p className="text-sm text-muted-foreground">{form.clinic.email} · {form.clinic.phone}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Specialties ({form.specialtyIds.length + form.customSpecialtyNames.length})</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.specialtyIds.map((id) => <span key={id} className="rounded-full bg-accent px-2.5 py-1 text-xs text-primary">{specialtyName(id)}</span>)}
                      {form.customSpecialtyNames.map((n) => <span key={n} className="rounded-full bg-accent px-2.5 py-1 text-xs text-primary">{n}</span>)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branch</p>
                    <p className="mt-1 font-medium text-foreground">{form.branch.name}</p>
                    <p className="text-sm text-muted-foreground">{form.branch.address}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</p>
                    <p className="mt-1 font-medium text-foreground">{form.owner.name}</p>
                    <p className="text-sm text-muted-foreground">{form.owner.email} · {form.owner.mobile}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between border-t pt-5">
            <Button variant="ghost" disabled={step === 1 || onboard.isPending} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            {step < 6 ? (
              <Button disabled={!canProceed} onClick={() => setStep((s) => s + 1)}>Continue</Button>
            ) : (
              <Button onClick={handleCreate} disabled={onboard.isPending}>
                {onboard.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Create Clinic
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
