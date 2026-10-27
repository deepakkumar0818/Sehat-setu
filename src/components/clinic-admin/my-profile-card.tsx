"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { PhoneInput } from "@/components/shared/phone-input";
import { QueryError } from "@/components/shared/query-error";
import { ApiRequestError } from "@/lib/api-client";
import { liveApi } from "@/lib/live-api";
import { formatPhone, OTHER_COUNTRY, PHONE_COUNTRIES, phoneFromParts, phoneParts } from "@/lib/phone";
import type { MyProfile } from "@/lib/live-types";

// Settings → Account: the signed-in member's own details. Your own account
// isn't listed in the Staff directory; you see and edit it here. Name and phone
// are saved through the same database checks as any staff edit.

const ROLE_LABEL: Record<string, string> = {
  ADMINISTRATOR: "Clinic Admin",
  CLINIC_MANAGER: "Clinic Manager",
  DOCTOR: "Doctor",
  RECEPTIONIST: "Receptionist",
  NURSE: "Nurse",
};

const PROFILE_KEY = ["me", "profile"] as const;

export function MyProfileCard() {
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: () => liveApi.account.profile() });
  const [editing, setEditing] = useState(false);
  const p = query.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>My profile</CardTitle>
          <CardDescription>Your details in this clinic. Your own account isn&apos;t listed under Staff.</CardDescription>
        </div>
        {p?.canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><PencilIcon /> Edit</Button>
        )}
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.error ? (
          <QueryError error={query.error} what="Your profile" onRetry={() => query.refetch()} />
        ) : p ? (
          editing ? <EditProfileForm profile={p} onDone={() => setEditing(false)} /> : <ProfileView profile={p} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProfileView({ profile: p }: { profile: MyProfile }) {
  const rows: [string, string][] = [
    ["Email", p.email],
    ["Phone", formatPhone(p.phone) || "Not set"],
    ["Role", p.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")],
    ["Branch", p.branchName ?? "All branches"],
  ];
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <PersonAvatar name={p.name} color="#2563eb" size="lg" />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-base font-semibold text-foreground">{p.name}</p>
          <p className="text-sm text-muted-foreground">{p.clinicName}</p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function EditProfileForm({ profile: p, onDone }: { profile: MyProfile; onDone: () => void }) {
  const queryClient = useQueryClient();
  const initial = phoneParts(p.phone);
  const [name, setName] = useState(p.name);
  const [country, setCountry] = useState(initial.country);
  const [otherDial, setOtherDial] = useState(initial.otherDial);
  const [national, setNational] = useState(initial.national);
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: (patch: { name?: string; phone?: string }) => liveApi.account.updateProfile(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(PROFILE_KEY, next);
      toast.success("Your profile is updated.");
      onDone();
    },
    meta: { inlineErrors: true },
  });

  const dial = country === OTHER_COUNTRY ? otherDial : (PHONE_COUNTRIES.find((c) => c.iso === country)?.dial ?? "");
  const phone = phoneFromParts(dial, national);
  const nameError = touched && name.trim().length < 2 ? "Enter your full name." : null;
  const phoneError = touched && national.trim() !== "" && !phone.ok ? phone.error : null;
  const patch = {
    ...(name.trim() !== p.name ? { name: name.trim() } : {}),
    ...(national.trim() !== "" && phone.ok && phone.e164 !== p.phone ? { phone: phone.e164 } : {}),
  };
  const changed = Object.keys(patch).length > 0;
  const serverError = save.error instanceof ApiRequestError ? save.error.message : save.error ? "Couldn't save your profile. Please try again." : null;

  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (name.trim().length < 2 || (national.trim() !== "" && !phone.ok) || !changed) return;
        save.mutate(patch);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="my-name">Full name</Label>
        <Input id="my-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(nameError)} />
        {nameError && <p className="text-xs text-danger">{nameError}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="my-phone">Phone number</Label>
        <PhoneInput
          id="my-phone"
          country={country}
          onCountryChange={setCountry}
          otherDial={otherDial}
          onOtherDialChange={setOtherDial}
          national={national}
          onNationalChange={setNational}
          onBlur={() => setTouched(true)}
          error={phoneError}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="my-email">Email</Label>
        <Input id="my-email" value={p.email} disabled readOnly />
        <p className="text-xs text-muted-foreground">Your email is how you sign in, so it can&apos;t be changed here.</p>
      </div>
      {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !changed}>
          {save.isPending && <Loader2Icon className="animate-spin" />} Save changes
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </form>
  );
}
