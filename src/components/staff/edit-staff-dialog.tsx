"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneInput } from "@/components/shared/phone-input";
import { useBranches } from "@/hooks/use-branches";
import { useUpdateStaffDetails } from "@/hooks/use-people";
import { ApiRequestError } from "@/lib/api-client";
import { OTHER_COUNTRY, PHONE_COUNTRIES, phoneFromParts, phoneParts } from "@/lib/phone";
import type { StaffMember } from "@/types";

// Administrators only (live data): edit a staff member's name, phone and
// branch. Only changed fields are sent; the server re-checks permission,
// branch scope and that the person's account isn't shared with another clinic.
// The email is their sign-in, so it isn't edited here. The role is changed in
// Users & Roles.

const ALL_BRANCHES = "all";

export function EditStaffDialog({ member, onOpenChange }: { member: StaffMember; onOpenChange: (open: boolean) => void }) {
  const branches = useBranches().filter((b) => b.status === "active" || b.id === member.branchId);
  const initial = phoneParts(member.phone);
  const [name, setName] = useState(member.name);
  const [country, setCountry] = useState(initial.country);
  const [otherDial, setOtherDial] = useState(initial.otherDial);
  const [national, setNational] = useState(initial.national);
  const [branch, setBranch] = useState(member.branchId || ALL_BRANCHES);
  const [touched, setTouched] = useState(false);
  const update = useUpdateStaffDetails();

  const dial = country === OTHER_COUNTRY ? otherDial : (PHONE_COUNTRIES.find((c) => c.iso === country)?.dial ?? "");
  const phone = phoneFromParts(dial, national);
  const phoneChanged = national.trim() !== "" && phone.ok && phone.e164 !== member.phone;
  const nameError = touched && name.trim().length < 2 ? "Enter the full name." : null;
  const phoneError = touched && national.trim() !== "" && !phone.ok ? phone.error : null;
  const serverError = update.error instanceof ApiRequestError ? update.error.message : update.error ? "Couldn't save the changes. Please try again." : null;

  const patch = {
    ...(name.trim() !== member.name ? { name: name.trim() } : {}),
    ...(phoneChanged && phone.ok ? { phone: phone.e164 } : {}),
    ...(branch !== (member.branchId || ALL_BRANCHES) ? { branchId: branch === ALL_BRANCHES ? null : branch } : {}),
  };
  const changed = Object.keys(patch).length > 0;

  const save = () => {
    setTouched(true);
    if (nameError || name.trim().length < 2 || (national.trim() !== "" && !phone.ok) || !changed || update.isPending) return;
    update.mutate(
      { id: member.id, patch },
      {
        onSuccess: () => {
          toast.success(`Details updated for ${name.trim()}.`);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit staff details</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-name">Full name</Label>
            <Input
              id="edit-staff-name"
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                if (update.error) update.reset();
              }}
              aria-invalid={Boolean(nameError)}
            />
            {nameError && <p className="text-xs text-danger">{nameError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-phone">Phone number</Label>
            <PhoneInput
              id="edit-staff-phone"
              country={country}
              onCountryChange={setCountry}
              otherDial={otherDial}
              onOtherDialChange={setOtherDial}
              national={national}
              onNationalChange={(v) => {
                setNational(v);
                if (update.error) update.reset();
              }}
              onBlur={() => setTouched(true)}
              error={phoneError}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-branch">Branch</Label>
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger id="edit-staff-branch" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-email">Email</Label>
            <Input id="edit-staff-email" value={member.email} disabled readOnly />
            <p className="text-xs text-muted-foreground">The email is how they sign in, so it can&apos;t be changed here. To change someone&apos;s role, use Users &amp; Roles.</p>
          </div>
          {serverError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || !changed}>
              {update.isPending && <Loader2Icon className="animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
