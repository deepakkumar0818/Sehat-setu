"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OTHER_COUNTRY, PHONE_COUNTRIES } from "@/lib/phone";

// Country code + national number. The parent owns the values and validates them
// with phoneFromParts() (src/lib/phone.ts); this only renders the fields and
// the inline error.

interface Props {
  id: string;
  /** ISO code from PHONE_COUNTRIES, or OTHER_COUNTRY. */
  country: string;
  onCountryChange: (iso: string) => void;
  /** Dial code typed for OTHER_COUNTRY (digits). */
  otherDial: string;
  onOtherDialChange: (dial: string) => void;
  national: string;
  onNationalChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
}

export function PhoneInput({ id, country, onCountryChange, otherDial, onOtherDialChange, national, onNationalChange, onBlur, error }: Props) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Select value={country} onValueChange={onCountryChange}>
          <SelectTrigger className="w-28 shrink-0" aria-label="Country code">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PHONE_COUNTRIES.map((c) => (
              <SelectItem key={c.iso} value={c.iso}>
                +{c.dial} {c.name}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_COUNTRY}>Other code…</SelectItem>
          </SelectContent>
        </Select>
        {country === OTHER_COUNTRY && (
          <Input
            aria-label="Country code digits"
            className="w-20 shrink-0"
            inputMode="numeric"
            placeholder="+code"
            value={otherDial}
            maxLength={4}
            onChange={(e) => onOtherDialChange(e.target.value.replace(/[^\d+]/g, ""))}
            onBlur={onBlur}
          />
        )}
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={country === "IN" ? "98765 43210" : "Phone number"}
          value={national}
          maxLength={24}
          onChange={(e) => onNationalChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
