"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/shared/phone-input";
import { useUpdateStaffPhone } from "@/hooks/use-people";
import { ApiRequestError } from "@/lib/api-client";
import { OTHER_COUNTRY, PHONE_COUNTRIES, phoneFromParts, phoneParts } from "@/lib/phone";
import type { StaffMember } from "@/types";

// Administrators only (live data): set a staff member's phone number. The
// server re-checks permission, branch scope and that the person's account
// isn't shared with another clinic; hiding this button is not the security.

export function EditPhoneDialog({ member, onOpenChange }: { member: StaffMember; onOpenChange: (open: boolean) => void }) {
  const initial = phoneParts(member.phone);
  const [country, setCountry] = useState(initial.country);
  const [otherDial, setOtherDial] = useState(initial.otherDial);
  const [national, setNational] = useState(initial.national);
  const [touched, setTouched] = useState(false);
  const update = useUpdateStaffPhone();

  const dial = country === OTHER_COUNTRY ? otherDial : (PHONE_COUNTRIES.find((c) => c.iso === country)?.dial ?? "");
  const phone = phoneFromParts(dial, national);
  const phoneError = touched && !phone.ok ? phone.error : null;
  const serverError = update.error instanceof ApiRequestError ? update.error.message : update.error ? "Couldn't save the phone number. Please try again." : null;

  const save = () => {
    setTouched(true);
    if (!phone.ok || update.isPending) return;
    update.mutate(
      { id: member.id, phone: phone.e164 },
      {
        onSuccess: () => {
          toast.success(`Phone number updated for ${member.name}.`);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit phone number</DialogTitle>
          <DialogDescription>{member.name}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">Phone number</Label>
            <PhoneInput
              id="edit-phone"
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
          {serverError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2Icon className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
