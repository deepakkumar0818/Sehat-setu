"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { useClinicProfile, useUpdateClinicProfile } from "@/hooks/use-clinic-admin";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { ClinicProfile, ClinicProfileInput } from "@/lib/live-types";

// Settings in the live staff app: the clinic profile (saved to the clinic
// database), the booking rules the system actually enforces (read-only), and
// the signed-in user's own account. Nothing here is a switch that does nothing.

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

const RULES = [
  ["Opening hours", "Monday to Saturday, 9:00 AM – 5:00 PM (IST). Closed on Sundays."],
  ["Lunch break", "1:00 – 2:00 PM: no appointments are booked."],
  ["Appointment length", "30 minutes per slot. A doctor can't be double-booked."],
  ["Online booking", "Patients book from the portal for doctors and branches of this clinic. Online (video) visits only with doctors who offer them."],
  ["Patient booking window", "From 30 minutes to 60 days ahead, with at most 5 upcoming appointments per patient."],
  ["Currency", "Indian Rupee (₹). Bills and expenses are stored to the paisa."],
] as const;

export function LiveSettings() {
  const user = useCurrentUser();
  const query = useClinicProfile();
  const clinic = query.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your clinic's profile, the booking rules in force, and your account." />

      <Card>
        <CardHeader>
          <CardTitle>Clinic profile</CardTitle>
          <CardDescription>Shown to patients in the portal and on bills.{clinic && !clinic.canEdit && " Only an administrator can change it."}</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>Booking rules</CardTitle>
          <CardDescription>How appointments work in Sehat Setu today. These are built into the system, so they apply to staff and patients alike.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            {RULES.map(([term, detail]) => (
              <div key={term} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-foreground">{term}</dt>
                <dd className="text-sm text-muted-foreground sm:col-span-2">{detail}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

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
            { href: "/doctor-roster", label: "Doctors" },
            { href: "/clinic/branches", label: "Branches" },
            { href: "/clinic/departments", label: "Departments" },
            { href: "/clinic/lab-tests", label: "Lab tests" },
            { href: "/audit-log", label: "Audit log" },
            { href: "/subscription", label: "Plan & usage" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent">{item.label}</Link>
          ))}
        </CardContent>
      </Card>
    </div>
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
