"use client";

import { Logo } from "@/components/shared/logo";
import { useClinicSettings } from "@/hooks/use-clinic-admin";
import { useLiveData } from "@/lib/data-source";
import type { BrandingSettings } from "@/lib/live-types";

// The header of printed bills and prescriptions: the clinic's logo (or name in
// its brand colour), registration number, GSTIN on bills, website, and the
// branch's address. Demo mode, and the moment before the clinic's settings
// load, show the Sehat Setu mark as before.

type Branch = { name?: string | null; address?: string | null; phone?: string | null };

export interface LetterheadProps {
  clinicName: string;
  branding: BrandingSettings;
  /** Bills show the GSTIN; prescriptions don't. */
  gstin?: string | null;
  branch?: Branch;
}

export function LetterheadView({ clinicName, branding, gstin, branch }: LetterheadProps) {
  const accent = branding.brandColor ?? undefined;
  const details = [branding.registrationNumber && `Reg. no. ${branding.registrationNumber}`, gstin && `GSTIN ${gstin}`].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-4" style={accent ? { borderBottomColor: accent, borderBottomWidth: 2 } : undefined}>
      <div className="min-w-0">
        {branding.logoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an inline data URL from the clinic's settings
          <img src={branding.logoDataUrl} alt={clinicName} className="max-h-14 max-w-[220px] object-contain" />
        ) : null}
        <p className={branding.logoDataUrl ? "mt-1 text-sm font-semibold text-foreground" : "text-lg font-semibold"} style={!branding.logoDataUrl && accent ? { color: accent } : undefined}>
          {clinicName}
        </p>
        {details && <p className="text-xs text-muted-foreground">{details}</p>}
        {branding.website && <p className="text-xs text-muted-foreground">{branding.website.replace(/^https?:\/\//, "")}</p>}
      </div>
      <div className="text-right text-sm text-muted-foreground">
        <p>{branch?.name}</p>
        <p>{branch?.address}</p>
        <p>{branch?.phone}</p>
      </div>
    </div>
  );
}

/** The live clinic's letterhead (falls back to the Sehat Setu mark in demo mode or while loading). */
export function ClinicLetterhead({ branch, kind }: { branch?: Branch; kind: "invoice" | "prescription" }) {
  const live = useLiveData();
  const { data } = useClinicSettings({ enabled: live });
  if (!live || !data) {
    return (
      <div className="flex items-start justify-between border-b pb-4">
        <Logo size="sm" />
        <div className="text-right text-sm text-muted-foreground">
          <p>{branch?.name}</p>
          <p>{branch?.address}</p>
          <p>{branch?.phone}</p>
        </div>
      </div>
    );
  }
  return <LetterheadView clinicName={data.clinic.name} branding={data.settings} gstin={kind === "invoice" ? data.settings.gstin : null} branch={branch} />;
}

/** Text printed under a bill (Settings → Billing), live clinics only. */
export function InvoiceFooterNote() {
  const live = useLiveData();
  const { data } = useClinicSettings({ enabled: live });
  const footer = live ? data?.settings.invoiceFooter : null;
  return footer ? <p className="mt-6 whitespace-pre-line border-t pt-3 text-xs text-muted-foreground">{footer}</p> : null;
}
