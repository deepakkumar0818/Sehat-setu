"use client";

import { useRef, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, MailWarningIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneInput } from "@/components/shared/phone-input";
import { DEFAULT_PHONE_COUNTRY, OTHER_COUNTRY, PHONE_COUNTRIES, phoneFromParts } from "@/lib/phone";
import { useBranches } from "@/hooks/use-branches";
import { useSpecialtyOptions } from "@/hooks/use-people";
import { useCreateInvitation } from "@/hooks/use-invitations";
import { INVITABLE_ROLES, type InvitableRole, type InvitationResult } from "@/lib/live-types";
import { DELIVERY_ERROR_TEXT, inviteErrorMessage, ROLE_LABEL } from "./invitation-labels";

// Invite a Doctor, Clinic Manager, Receptionist or Nurse (Administrators only;
// the server re-checks everything). Live data only — there is no demo version.
// The result reports the email attempt honestly: "sent" means handed to the
// email provider, never that the person has joined.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixes the role (e.g. "DOCTOR" from the Doctors page); otherwise the user picks. */
  role?: InvitableRole;
}

const EMPTY_DOCTOR = { specialtyId: "", qualifications: "", registrationNumber: "", experienceYears: "", consultationFee: "", onlineConsultation: false };

export function InviteStaffDialog({ open, onOpenChange, role: fixedRole }: Props) {
  const branches = useBranches().filter((b) => b.status === "active");
  const specialties = useSpecialtyOptions();
  const create = useCreateInvitation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [otherDial, setOtherDial] = useState("");
  const [phoneNational, setPhoneNational] = useState("");
  // Inline phone errors appear once the field has been left (or a submit was attempted), not while typing.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [roleKey, setRoleKey] = useState<InvitableRole>(fixedRole ?? "RECEPTIONIST");
  const [chosenBranchId, setBranchId] = useState("");
  // A clinic (or branch-restricted admin) with a single active branch: that branch is the only valid choice.
  const branchId = chosenBranchId || (branches.length === 1 ? branches[0].id : "");
  const [doctor, setDoctor] = useState(EMPTY_DOCTOR);
  const [result, setResult] = useState<InvitationResult | null>(null);
  // Blocks a second submit before React re-renders with isPending (e.g. a fast double click or Enter + click).
  const submitting = useRef(false);
  const role = fixedRole ?? roleKey;
  const isDoctor = role === "DOCTOR";

  const reset = () => {
    setName(""); setEmail(""); setBranchId(""); setDoctor(EMPTY_DOCTOR); setResult(null); create.reset();
    setPhoneCountry(DEFAULT_PHONE_COUNTRY); setOtherDial(""); setPhoneNational(""); setPhoneTouched(false);
    if (!fixedRole) setRoleKey("RECEPTIONIST");
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const doctorReady =
    !isDoctor ||
    (doctor.specialtyId && doctor.qualifications.trim() && doctor.registrationNumber.trim() && doctor.experienceYears !== "" && doctor.consultationFee !== "");
  const dial = phoneCountry === OTHER_COUNTRY ? otherDial : (PHONE_COUNTRIES.find((c) => c.iso === phoneCountry)?.dial ?? "");
  const phone = phoneFromParts(dial, phoneNational);
  const phoneError = phoneTouched && !phone.ok ? phone.error : null;
  const canSubmit = name.trim().length >= 2 && email.trim() && branchId && doctorReady && !create.isPending;

  const submit = () => {
    setPhoneTouched(true);
    if (!canSubmit || !phone.ok || submitting.current) return;
    submitting.current = true;
    create.mutate(
      {
        name,
        email,
        roleKey: role,
        branchId,
        phone: phone.e164,
        doctor: isDoctor
          ? {
              specialtyId: doctor.specialtyId,
              qualifications: doctor.qualifications,
              registrationNumber: doctor.registrationNumber,
              experienceYears: Number(doctor.experienceYears),
              consultationFee: Number(doctor.consultationFee),
              onlineConsultation: doctor.onlineConsultation,
            }
          : undefined,
      },
      {
        onSuccess: setResult,
        onError: (err) => {
          // Server errors are shown as returned; anything else is logged for debugging, never shown raw.
          if (!(err instanceof Error && err.name === "ApiRequestError")) console.error("[invite] unexpected client error", err);
        },
        onSettled: () => {
          submitting.current = false;
        },
      }
    );
  };

  const failure = create.error ? inviteErrorMessage(create.error) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isDoctor && fixedRole ? "Invite a doctor" : "Invite staff"}</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email to sign in, then must accept the invitation before they can see anything in your clinic. Invitations expire after 7 days.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-2">
            {result.delivery.status === "sent" ? (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-muted p-3 text-sm text-success">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Invitation saved and the email was handed to the email service. {result.invitation.name} joins only after they sign in and accept it.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-muted p-3 text-sm text-warning">
                <MailWarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Invitation saved, but the email couldn&apos;t be sent: {DELIVERY_ERROR_TEXT[result.delivery.error ?? ""] ?? "the email service refused it"}. You can resend it from the
                  Invitations tab.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Invite someone else</Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Full name</Label>
                <Input id="invite-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invite-phone">Phone number</Label>
                <PhoneInput
                  id="invite-phone"
                  country={phoneCountry}
                  onCountryChange={setPhoneCountry}
                  otherDial={otherDial}
                  onOtherDialChange={setOtherDial}
                  national={phoneNational}
                  onNationalChange={setPhoneNational}
                  onBlur={() => setPhoneTouched(true)}
                  error={phoneError}
                />
              </div>
              {!fixedRole && (
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={roleKey} onValueChange={(v) => setRoleKey(v as InvitableRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVITABLE_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger><SelectValue placeholder="Choose a branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isDoctor && (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Specialty</Label>
                  <Select value={doctor.specialtyId} onValueChange={(v) => setDoctor({ ...doctor, specialtyId: v })}>
                    <SelectTrigger><SelectValue placeholder={specialties.isLoading ? "Loading…" : "Choose a specialty"} /></SelectTrigger>
                    <SelectContent>
                      {(specialties.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {specialties.isError && <p className="text-xs text-danger">Couldn&apos;t load specialties. Close and try again.</p>}
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="invite-qual">Qualifications</Label>
                  <Input id="invite-qual" value={doctor.qualifications} maxLength={200} placeholder="e.g. MBBS, MD (Medicine)" onChange={(e) => setDoctor({ ...doctor, qualifications: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-reg">Registration number</Label>
                  <Input id="invite-reg" value={doctor.registrationNumber} maxLength={40} onChange={(e) => setDoctor({ ...doctor, registrationNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-exp">Experience (years)</Label>
                  <Input id="invite-exp" type="number" min={0} max={70} step={1} value={doctor.experienceYears} onChange={(e) => setDoctor({ ...doctor, experienceYears: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-fee">Consultation fee (₹)</Label>
                  <Input id="invite-fee" type="number" min={0} max={100000} step="0.01" value={doctor.consultationFee} onChange={(e) => setDoctor({ ...doctor, consultationFee: e.target.value })} />
                </div>
                <div className="flex items-center justify-between gap-2 self-end rounded-md border px-3 py-2">
                  <Label htmlFor="invite-online">Online consultations</Label>
                  <Switch id="invite-online" checked={doctor.onlineConsultation} onCheckedChange={(v) => setDoctor({ ...doctor, onlineConsultation: v })} />
                </div>
              </div>
            )}

            {failure && (
              <div role="alert" className="rounded-md border border-danger/30 bg-danger-muted p-3 text-sm text-danger">
                <p>{failure.message}</p>
                {failure.fields.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {failure.fields.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={!canSubmit}>
                {create.isPending && <Loader2Icon className="animate-spin" />} Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
