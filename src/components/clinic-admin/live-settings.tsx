"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ImageUpIcon, InfoIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LetterheadView } from "@/components/shared/clinic-letterhead";
import { PageHeader } from "@/components/shared/page-header";
import { ClinicJoinLink } from "@/components/shared/clinic-join-link";
import { QueryError } from "@/components/shared/query-error";
import { useClinicProfile, useClinicSettings, useUpdateClinicProfile, useUpdateClinicSettings } from "@/hooks/use-clinic-admin";
import { useCurrentUser } from "@/hooks/use-current-user";
import { clock, describeWeek, SLOT_MINUTES, slotTimesFor, toMinutes, WEEKDAY_LABELS, WEEKDAYS } from "@/lib/clinic-hours";
import type { ClinicProfile, ClinicProfileInput, ClinicSettings, ClinicSettingsPage, Weekday } from "@/lib/live-types";

// Settings in the live staff app. Everything here is saved to the clinic
// database and enforced there: the timings and booking rules by the booking
// functions, the invoice prefix by invoice numbering, the payment methods when
// a payment is recorded. Nothing here is a switch that does nothing. Only
// clinic-wide administrators can change them; everyone else sees them read-only.

export function LiveSettings() {
  const settings = useClinicSettings();
  const page = settings.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your clinic's profile and branding, opening hours, online booking and billing." />
      {page && !page.canEdit && (
        <div role="note" className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>You can see your clinic&apos;s settings. Only a clinic administrator can change them.</span>
        </div>
      )}

      <Tabs defaultValue="profile">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="profile">Profile &amp; branding</TabsTrigger>
          <TabsTrigger value="timings">Clinic timings</TabsTrigger>
          <TabsTrigger value="booking">Online booking</TabsTrigger>
          <TabsTrigger value="billing">Billing &amp; invoices</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-5">
          <Loaded query={settings}>{(p) => <PatientLinkCard page={p} />}</Loaded>
          <ClinicProfileCard />
          <Loaded query={settings}>{(p) => <BrandingCard page={p} />}</Loaded>
        </TabsContent>
        <TabsContent value="timings" className="mt-4">
          <Loaded query={settings}>{(p) => <TimingsCard page={p} />}</Loaded>
        </TabsContent>
        <TabsContent value="booking" className="mt-4 space-y-5">
          <Loaded query={settings}>{(p) => <PatientLinkCard page={p} />}</Loaded>
          <Loaded query={settings}>{(p) => <BookingCard page={p} />}</Loaded>
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <Loaded query={settings}>{(p) => <BillingCard page={p} />}</Loaded>
        </TabsContent>
        <TabsContent value="account" className="mt-4 space-y-5">
          <AccountCards />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Loaded({ query, children }: { query: ReturnType<typeof useClinicSettings>; children: (page: ClinicSettingsPage) => React.ReactNode }) {
  if (query.isLoading) return <Skeleton className="h-80 w-full rounded-xl" />;
  if (query.error) return <QueryError error={query.error} what="Clinic settings" onRetry={() => query.refetch()} />;
  return query.data ? <>{children(query.data)}</> : null;
}

// --- Saving a section -------------------------------------------------------------

/** A section's own fields: a draft, what changed, and saving only those (the break's start and end together). */
function useSection<K extends keyof ClinicSettings>(saved: ClinicSettings, keys: readonly K[]) {
  const pick = (s: ClinicSettings) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<ClinicSettings, K>;
  const [base, setBase] = useState(() => pick(saved));
  const [draft, setDraft] = useState(() => pick(saved));
  const update = useUpdateClinicSettings();
  const changed = keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]));

  const set = <F extends K>(key: F, value: ClinicSettings[F]) => setDraft((d) => ({ ...d, [key]: value }));
  function save(message: string) {
    const send = new Set<K>(changed);
    for (const [a, b] of [["breakStart", "breakEnd"], ["breakEnd", "breakStart"]] as const) {
      if (send.has(a as K) && keys.includes(b as K)) send.add(b as K);
    }
    const patch = Object.fromEntries([...send].map((k) => [k, draft[k]])) as Partial<ClinicSettings>;
    update.mutate(patch, {
      onSuccess: (page) => {
        const next = pick(page.settings);
        setBase(next);
        setDraft(next);
        toast.success(message);
      },
    });
  }
  return { draft, set, changed, save, discard: () => setDraft(base), pending: update.isPending };
}

function SaveBar({ canEdit, changed, pending, invalid, onDiscard }: { canEdit: boolean; changed: number; pending: boolean; invalid?: string | null; onDiscard: () => void }) {
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <Button type="submit" disabled={pending || changed === 0 || Boolean(invalid)}>{pending ? "Saving…" : "Save changes"}</Button>
      {changed > 0 && <Button type="button" variant="outline" onClick={onDiscard} disabled={pending}>Discard</Button>}
      {invalid && changed > 0 && <p role="alert" className="text-sm text-danger">{invalid}</p>}
    </div>
  );
}

function Row({ label, description, children, htmlFor }: { label: string; description?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</Label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// --- Profile & branding -------------------------------------------------------------

const FIELDS: { key: keyof ClinicProfileInput; label: string; type?: string; span?: boolean; max: number }[] = [
  { key: "name", label: "Clinic name", span: true, max: 120 },
  { key: "email", label: "Contact email", type: "email", max: 254 },
  { key: "phone", label: "Contact phone", type: "tel", max: 20 },
  { key: "addressLine", label: "Address", span: true, max: 300 },
  { key: "city", label: "City", max: 80 },
  { key: "state", label: "State", max: 80 },
  { key: "pincode", label: "PIN code", max: 6 },
];

const toForm = (c: ClinicProfile): ClinicProfileInput => ({ name: c.name, email: c.email, phone: c.phone, addressLine: c.addressLine, city: c.city, state: c.state, pincode: c.pincode });

function ClinicProfileCard() {
  const query = useClinicProfile();
  const clinic = query.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic profile</CardTitle>
        <CardDescription>Shown to patients in the portal and on bills.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : query.error ? (
          <QueryError error={query.error} what="Clinic details" onRetry={() => query.refetch()} />
        ) : clinic ? (
          <ClinicProfileForm clinic={clinic} />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Starts from the loaded profile; after a save it continues from what the server stored. */
function ClinicProfileForm({ clinic }: { clinic: ClinicProfile }) {
  const update = useUpdateClinicProfile();
  const [saved, setSaved] = useState<ClinicProfile>(clinic);
  const [form, setForm] = useState<ClinicProfileInput>(() => toForm(clinic));
  const changed = (Object.keys(form) as (keyof ClinicProfileInput)[]).filter((k) => form[k].trim() !== saved[k]);

  function save() {
    if (changed.length === 0) return;
    const patch = Object.fromEntries(changed.map((k) => [k, form[k].trim()])) as Partial<ClinicProfileInput>;
    update.mutate(patch, {
      onSuccess: (c) => {
        setSaved(c);
        setForm(toForm(c));
        toast.success("Clinic profile saved.");
      },
    });
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.span ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <Label htmlFor={`clinic-${f.key}`}>{f.label}</Label>
            <Input
              id={`clinic-${f.key}`}
              type={f.type ?? "text"}
              value={form[f.key]}
              maxLength={f.max}
              disabled={!clinic.canEdit}
              inputMode={f.key === "pincode" ? "numeric" : undefined}
              onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Clinic code: <span className="font-medium text-foreground">{clinic.code}</span> · Currency: {clinic.currency}</p>
      {clinic.canEdit && (
        <div className="flex gap-2">
          <Button type="submit" disabled={update.isPending || changed.length === 0}>{update.isPending ? "Saving…" : "Save changes"}</Button>
          {changed.length > 0 && <Button type="button" variant="outline" onClick={() => setForm(toForm(saved))}>Discard</Button>}
        </div>
      )}
    </form>
  );
}

const BRANDING = ["logoDataUrl", "brandColor", "website", "registrationNumber"] as const;
const MAX_LOGO_CHARS = 300_000;

/** Scales an uploaded image to fit 480×240 and re-encodes it small enough to store inline. */
async function fileToLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP image.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image couldn't be read."));
      el.src = url;
    });
    const scale = Math.min(1, 480 / img.width, 240 / img.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [["image/png", undefined], ["image/webp", 0.9], ["image/jpeg", 0.85]] as const) {
      const data = canvas.toDataURL(type, quality);
      if (data.startsWith(`data:${type};`) && data.length <= MAX_LOGO_CHARS) return data;
    }
    throw new Error("That image is too detailed to use as a logo. Try a simpler or smaller one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function BrandingCard({ page }: { page: ClinicSettingsPage }) {
  const { draft, set, changed, save, discard, pending } = useSection(page.settings, BRANDING);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = page.canEdit;

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      set("logoDataUrl", await fileToLogo(file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That image couldn't be used.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Your logo and details at the top of printed bills and prescriptions.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save("Branding saved."); }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Logo</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-40 items-center justify-center rounded-md border bg-muted/30 p-1">
                  {draft.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- an inline data URL
                    <img src={draft.logoDataUrl} alt="Clinic logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">No logo</span>
                  )}
                </div>
                {canEdit && (
                  <>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload logo" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
                    <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><ImageUpIcon /> {draft.logoDataUrl ? "Change logo" : "Upload logo"}</Button>
                    {draft.logoDataUrl && <Button type="button" variant="ghost" onClick={() => set("logoDataUrl", null)}><Trash2Icon /> Remove</Button>}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPEG or WebP. It&apos;s resized to fit; a wide logo on a transparent background looks best.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-color">Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  id="brand-color"
                  type="color"
                  value={draft.brandColor ?? "#0f766e"}
                  disabled={!canEdit}
                  onChange={(e) => set("brandColor", e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1 disabled:cursor-not-allowed"
                />
                <span className="font-mono text-sm text-muted-foreground">{draft.brandColor ?? "Not set"}</span>
                {canEdit && draft.brandColor && <Button type="button" variant="ghost" size="sm" onClick={() => set("brandColor", null)}>Clear</Button>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-website">Website</Label>
              <Input id="brand-website" value={draft.website ?? ""} maxLength={200} disabled={!canEdit} placeholder="www.yourclinic.in" onChange={(e) => set("website", e.target.value || null)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="brand-reg">Clinic registration number</Label>
              <Input id="brand-reg" value={draft.registrationNumber ?? ""} maxLength={60} disabled={!canEdit} placeholder="e.g. Clinical Establishment registration no." onChange={(e) => set("registrationNumber", e.target.value || null)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="rounded-xl border bg-card p-5">
              <LetterheadView
                clinicName={page.clinic.name}
                branding={draft}
                gstin={page.settings.gstin}
                branch={{ name: "Your branch", address: "Branch address", phone: "Branch phone" }}
              />
            </div>
          </div>
          <SaveBar canEdit={canEdit} changed={changed.length} pending={pending} onDiscard={discard} />
        </form>
      </CardContent>
    </Card>
  );
}

// --- Clinic timings -------------------------------------------------------------------

const TIMINGS = ["weeklyHours", "breakStart", "breakEnd", "slotMinutes"] as const;
/** A Monday, to preview each weekday's slots. */
const PREVIEW_WEEK = "2026-10-12";
const previewDate = (day: Weekday) => new Date(Date.parse(`${PREVIEW_WEEK}T00:00:00Z`) + WEEKDAYS.indexOf(day) * 864e5).toISOString().slice(0, 10);

function timingsProblem(t: Pick<ClinicSettings, (typeof TIMINGS)[number]>): string | null {
  for (const day of WEEKDAYS) {
    const h = t.weeklyHours[day];
    if (!h) continue;
    if (!h.open || !h.close) return `Enter ${WEEKDAY_LABELS[day]}'s opening and closing times.`;
    if (toMinutes(h.open) >= toMinutes(h.close)) return `${WEEKDAY_LABELS[day]}: closing time must be after opening time.`;
    if (toMinutes(h.open) % 5 || toMinutes(h.close) % 5) return `${WEEKDAY_LABELS[day]}: use times in 5-minute steps.`;
  }
  if (t.breakStart !== null || t.breakEnd !== null) {
    if (!t.breakStart || !t.breakEnd) return "Enter the break's start and end.";
    if (toMinutes(t.breakStart) >= toMinutes(t.breakEnd)) return "The break must end after it starts.";
  }
  return null;
}

function TimingsCard({ page }: { page: ClinicSettingsPage }) {
  const { draft, set, changed, save, discard, pending } = useSection(page.settings, TIMINGS);
  const [previewDay, setPreviewDay] = useState<Weekday>("mon");
  const canEdit = page.canEdit;
  const problem = timingsProblem(draft);
  const preview = problem ? [] : slotTimesFor(previewDate(previewDay), draft);
  const hasBreak = draft.breakStart !== null || draft.breakEnd !== null;

  const setDay = (day: Weekday, value: { open: string; close: string } | null) => set("weeklyHours", { ...draft.weeklyHours, [day]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic timings</CardTitle>
        <CardDescription>
          When patients can book, and the free slots reception is offered. Existing appointments stay as they are, and staff can still book outside these hours
          (walk-ins, extra sessions). Times are IST.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save("Clinic timings saved. New bookings use them now."); }}>
          <div className="divide-y rounded-md border">
            {WEEKDAYS.map((day) => {
              const h = draft.weeklyHours[day];
              return (
                <div key={day} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="flex w-36 items-center gap-2">
                    <Switch id={`open-${day}`} checked={h !== null} disabled={!canEdit} onCheckedChange={(on) => setDay(day, on ? { open: "09:00", close: "17:00" } : null)} />
                    <Label htmlFor={`open-${day}`} className="text-sm font-medium">{WEEKDAY_LABELS[day]}</Label>
                  </div>
                  {h ? (
                    <div className="flex items-center gap-2">
                      <Input type="time" step={300} value={h.open} disabled={!canEdit} aria-label={`${WEEKDAY_LABELS[day]} opens`} className="w-32" onChange={(e) => setDay(day, { ...h, open: e.target.value })} />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input type="time" step={300} value={h.close} disabled={!canEdit} aria-label={`${WEEKDAY_LABELS[day]} closes`} className="w-32" onChange={(e) => setDay(day, { ...h, close: e.target.value })} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="has-break" checked={hasBreak} disabled={!canEdit} onCheckedChange={(on) => { set("breakStart", on ? "13:00" : null); set("breakEnd", on ? "14:00" : null); }} />
                <Label htmlFor="has-break" className="text-sm font-medium">Daily break (e.g. lunch)</Label>
              </div>
              {hasBreak ? (
                <div className="flex items-center gap-2">
                  <Input type="time" step={300} value={draft.breakStart ?? ""} disabled={!canEdit} aria-label="Break starts" className="w-32" onChange={(e) => set("breakStart", e.target.value || null)} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input type="time" step={300} value={draft.breakEnd ?? ""} disabled={!canEdit} aria-label="Break ends" className="w-32" onChange={(e) => set("breakEnd", e.target.value || null)} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No break: appointments all day.</p>
              )}
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="slot-length" className="text-sm font-medium">Appointment length</Label>
              <Select value={String(draft.slotMinutes)} disabled={!canEdit} onValueChange={(v) => set("slotMinutes", Number(v) as ClinicSettings["slotMinutes"])}>
                <SelectTrigger id="slot-length" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{SLOT_MINUTES.map((m) => <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">One slot per patient. A doctor is never booked for overlapping times.</p>
            </div>
          </div>

          <div className="space-y-2 rounded-md bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Slots patients will see</p>
              <Select value={previewDay} onValueChange={(v) => setPreviewDay(v as Weekday)}>
                <SelectTrigger className="h-8 w-36" aria-label="Preview day"><SelectValue /></SelectTrigger>
                <SelectContent>{WEEKDAYS.map((d) => <SelectItem key={d} value={d}>{WEEKDAY_LABELS[d]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {problem ? (
              <p className="text-sm text-danger">{problem}</p>
            ) : preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">No slots: closed on {WEEKDAY_LABELS[previewDay]}s.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{preview.length} slots of {draft.slotMinutes} minutes</p>
                <div className="flex flex-wrap gap-1.5">{preview.map((t) => <span key={t} className="rounded border bg-background px-2 py-0.5 text-xs">{clock(t)}</span>)}</div>
              </>
            )}
            {!problem && <p className="text-xs text-muted-foreground">{describeWeek(draft.weeklyHours).join(" · ")}</p>}
          </div>

          <SaveBar canEdit={canEdit} changed={changed.length} pending={pending} invalid={problem} onDiscard={discard} />
        </form>
      </CardContent>
    </Card>
  );
}

// --- Online booking -------------------------------------------------------------------

const BOOKING = ["onlineBookingEnabled", "bookingNeedsApproval", "bookingMinNoticeMinutes", "bookingMaxDaysAhead", "bookingMaxUpcoming", "patientOnlinePayments"] as const;
const NOTICE: { value: number; label: string }[] = [
  { value: 0, label: "No minimum" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "1 day" },
  { value: 2880, label: "2 days" },
];

function bookingProblem(b: Pick<ClinicSettings, (typeof BOOKING)[number]>): string | null {
  if (!Number.isInteger(b.bookingMaxDaysAhead) || b.bookingMaxDaysAhead < 1 || b.bookingMaxDaysAhead > 180) return "Patients can book from 1 to 180 days ahead.";
  if (!Number.isInteger(b.bookingMaxUpcoming) || b.bookingMaxUpcoming < 1 || b.bookingMaxUpcoming > 20) return "Allow 1 to 20 upcoming appointments per patient.";
  return null;
}

function PatientLinkCard({ page }: { page: ClinicSettingsPage }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient registration &amp; booking link</CardTitle>
        <CardDescription>
          Share it on WhatsApp, your website or a poster. Patients who register through it join {page.clinic.name} and book with your doctors only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ClinicJoinLink code={page.clinic.code} />
        {!page.settings.onlineBookingEnabled && (
          <p className="text-xs text-muted-foreground">Online bookings are off below: patients can still register through the link, then call the clinic to book.</p>
        )}
      </CardContent>
    </Card>
  );
}

function BookingCard({ page }: { page: ClinicSettingsPage }) {
  const { draft, set, changed, save, discard, pending } = useSection(page.settings, BOOKING);
  const canEdit = page.canEdit;
  const notice = NOTICE.some((n) => n.value === draft.bookingMinNoticeMinutes) ? NOTICE : [...NOTICE, { value: draft.bookingMinNoticeMinutes, label: `${draft.bookingMinNoticeMinutes} minutes` }];
  const off = !draft.onlineBookingEnabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online booking</CardTitle>
        <CardDescription>How patients book from the patient portal. Reception books at the desk as usual.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); save("Online booking rules saved."); }}>
          <div className="divide-y">
            <Row label="Accept online bookings" htmlFor="bk-on" description="When off, patients can't book or reschedule online (they can still cancel), and the portal asks them to call the clinic.">
              <Switch id="bk-on" checked={draft.onlineBookingEnabled} disabled={!canEdit} onCheckedChange={(v) => set("onlineBookingEnabled", v)} />
            </Row>
            <Row
              label="Reception approves each booking"
              htmlFor="bk-approve"
              description={draft.bookingNeedsApproval ? "A booking is a request until reception approves it in Appointments." : "Bookings are confirmed straight away and go on the doctor's schedule."}
            >
              <Switch id="bk-approve" checked={draft.bookingNeedsApproval} disabled={!canEdit || off} onCheckedChange={(v) => set("bookingNeedsApproval", v)} />
            </Row>
            <Row label="Minimum notice" htmlFor="bk-notice" description="How soon before a slot patients can still book it.">
              <Select value={String(draft.bookingMinNoticeMinutes)} disabled={!canEdit || off} onValueChange={(v) => set("bookingMinNoticeMinutes", Number(v))}>
                <SelectTrigger id="bk-notice" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{notice.map((n) => <SelectItem key={n.value} value={String(n.value)}>{n.label}</SelectItem>)}</SelectContent>
              </Select>
            </Row>
            <Row label="Book up to" htmlFor="bk-days" description="How far ahead patients can book.">
              <div className="flex items-center gap-2">
                <Input id="bk-days" type="number" min={1} max={180} className="w-24" value={draft.bookingMaxDaysAhead} disabled={!canEdit || off} onChange={(e) => set("bookingMaxDaysAhead", Number(e.target.value))} />
                <span className="text-sm text-muted-foreground">days ahead</span>
              </div>
            </Row>
            <Row label="Upcoming bookings per patient" htmlFor="bk-max" description="Requests awaiting approval count too.">
              <Input id="bk-max" type="number" min={1} max={20} className="w-24" value={draft.bookingMaxUpcoming} disabled={!canEdit || off} onChange={(e) => set("bookingMaxUpcoming", Number(e.target.value))} />
            </Row>
            <Row label="Patients can pay online" htmlFor="bk-pay" description="Bills and consultation fees from the portal, once online payments are set up for the clinic. When off, patients pay at the clinic.">
              <Switch id="bk-pay" checked={draft.patientOnlinePayments} disabled={!canEdit} onCheckedChange={(v) => set("patientOnlinePayments", v)} />
            </Row>
          </div>
          <SaveBar canEdit={canEdit} changed={changed.length} pending={pending} invalid={bookingProblem(draft)} onDiscard={discard} />
        </form>
      </CardContent>
    </Card>
  );
}

// --- Billing & invoices ------------------------------------------------------------------

const BILLING = ["invoicePrefix", "gstin", "defaultTaxPercent", "invoiceFooter", "paymentMethods"] as const;
const TAX_RATES = [0, 5, 12, 18, 28];
const METHODS: { value: ClinicSettings["paymentMethods"][number]; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "online", label: "Online (paid elsewhere)" },
];

function billingProblem(b: Pick<ClinicSettings, (typeof BILLING)[number]>): string | null {
  const prefix = b.invoicePrefix?.trim().toUpperCase();
  if (prefix && !/^[A-Z0-9][A-Z0-9/-]{0,11}$/.test(prefix)) return "Invoice prefix: up to 12 letters, digits, / or -.";
  const gstin = b.gstin?.trim().toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return "Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5.";
  if (b.paymentMethods.length === 0) return "Keep at least one payment method.";
  return null;
}

function BillingCard({ page }: { page: ClinicSettingsPage }) {
  const { draft, set, changed, save, discard, pending } = useSection(page.settings, BILLING);
  const canEdit = page.canEdit;
  const prefix = draft.invoicePrefix?.trim().toUpperCase() || page.defaultInvoicePrefix;
  const taxRates = TAX_RATES.includes(draft.defaultTaxPercent) ? TAX_RATES : [...TAX_RATES, draft.defaultTaxPercent].sort((a, b) => a - b);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing &amp; invoices</CardTitle>
        <CardDescription>How bills are numbered and printed, and how reception records payments.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save("Billing settings saved."); }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bill-prefix">Invoice number prefix</Label>
              <Input id="bill-prefix" value={draft.invoicePrefix ?? ""} maxLength={12} disabled={!canEdit} placeholder={page.defaultInvoicePrefix} className="uppercase"
                onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase() || null)} />
              <p className="text-xs text-muted-foreground">
                Bills are numbered <span className="font-mono text-foreground">{prefix}0001</span>, <span className="font-mono text-foreground">{prefix}0002</span>, … A new prefix starts its own numbering; existing bills keep theirs.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-gstin">GSTIN</Label>
              <Input id="bill-gstin" value={draft.gstin ?? ""} maxLength={15} disabled={!canEdit} placeholder="Not registered" className="uppercase"
                onChange={(e) => set("gstin", e.target.value.toUpperCase() || null)} />
              <p className="text-xs text-muted-foreground">Printed on bills when set.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-tax">Default tax on new bills</Label>
              <Select value={String(draft.defaultTaxPercent)} disabled={!canEdit} onValueChange={(v) => set("defaultTaxPercent", Number(v))}>
                <SelectTrigger id="bill-tax" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{taxRates.map((r) => <SelectItem key={r} value={String(r)}>{r === 0 ? "No tax (0%)" : `${r}%`}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Filled in on new manual bills; reception can change it per bill. Consultation bills from appointments stay untaxed (doctor consultations are usually GST-exempt).</p>
            </div>
            <div className="space-y-1.5">
              <Label>Payment methods reception records</Label>
              <div className="grid grid-cols-1 gap-1.5">
                {METHODS.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.paymentMethods.includes(m.value)}
                      disabled={!canEdit}
                      onCheckedChange={(on) => set("paymentMethods", on ? [...draft.paymentMethods, m.value] : draft.paymentMethods.filter((x) => x !== m.value))}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bill-footer">Footer printed on bills</Label>
              <Textarea id="bill-footer" rows={3} maxLength={500} disabled={!canEdit} value={draft.invoiceFooter ?? ""} placeholder="e.g. Thank you for visiting. Payments are non-refundable after the consultation."
                onChange={(e) => set("invoiceFooter", e.target.value || null)} />
              <p className="text-xs text-muted-foreground">{(draft.invoiceFooter ?? "").length}/500</p>
            </div>
          </div>
          <SaveBar canEdit={canEdit} changed={changed.length} pending={pending} invalid={billingProblem(draft)} onDiscard={discard} />
        </form>
      </CardContent>
    </Card>
  );
}

// --- Account ---------------------------------------------------------------------------

function AccountCards() {
  const user = useCurrentUser();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>{user ? `Signed in as ${user.name} (${user.email}).` : "Your sign-in details."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/auth/set-password">Change password</Link></Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>More settings</CardTitle><CardDescription>Related configuration lives in its own section.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { href: "/staff", label: "Staff & invitations" },
            { href: "/clinic/users", label: "Users & roles" },
            { href: "/doctor-roster", label: "Doctors" },
            { href: "/clinic/branches", label: "Branches" },
            { href: "/clinic/departments", label: "Departments" },
            { href: "/clinic/specialties", label: "Specialties" },
            { href: "/clinic/lab-tests", label: "Lab tests" },
            { href: "/audit-log", label: "Audit log" },
            { href: "/subscription", label: "Plan & usage" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent">{item.label}</Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
