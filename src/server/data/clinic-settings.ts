import "server-only";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import { onlinePaymentsConfigured } from "@/server/payments/razorpay";
import type { Prisma } from "@/generated/prisma/client";
import type { ClinicSettings, ClinicSettingsPage } from "@/lib/live-types";
import { clinicSettingsPatchSchema, toClinicSettings, toDbPatch, type ClinicSettingsRow } from "./clinic-settings-rules";
import { errorText } from "./document-rules";
import { runScoped } from "./scope";

// The clinic's settings (migration 20261102000000_clinic_settings): timings,
// online booking rules, billing and branding. Read by every member of the
// clinic (RLS clinic_settings_read: staff and the clinic's patients); changed
// by clinic-wide administrators (clinic_settings_update). The database's
// booking functions and invoice numbering read the same row, so what is saved
// here is what is enforced. Changes are audited by the row-change trigger.

export const SETTINGS_MANAGE = ["clinic.settings.manage"] as const;

const settingsSelect = {
  weeklyHours: true, breakStart: true, breakEnd: true, slotMinutes: true,
  onlineBookingEnabled: true, bookingNeedsApproval: true, bookingMinNoticeMinutes: true, bookingMaxDaysAhead: true, bookingMaxUpcoming: true, patientOnlinePayments: true,
  invoicePrefix: true, gstin: true, defaultTaxPercent: true, invoiceFooter: true, paymentMethods: true,
  logoDataUrl: true, website: true, registrationNumber: true,
} as const;

/** As the clinic_settings_update policy: the permission and a clinic-wide (not branch-restricted) membership. */
const canEdit = (ctx: TenantContext) => hasAnyPermission(ctx, SETTINGS_MANAGE) && !ctx.branchId;

/** The clinic's settings inside an existing transaction (staff or patient). Falls back to the defaults if the row is missing. */
export async function loadClinicSettings(tx: TenantTx, clinicId: string): Promise<ClinicSettings> {
  const [row, clinic] = await Promise.all([
    tx.clinicSettings.findUnique({ where: { clinicId }, select: settingsSelect }),
    tx.clinic.findUnique({ where: { id: clinicId }, select: { brandColor: true } }),
  ]);
  return toClinicSettings(row as ClinicSettingsRow | null, clinic?.brandColor ?? null);
}

/** Online payments are set up and the clinic lets patients pay online. Patient transaction: RLS leaves only their clinic's row. */
export async function patientCanPayOnline(tx: TenantTx): Promise<boolean> {
  if (!onlinePaymentsConfigured()) return false;
  const settings = await tx.clinicSettings.findFirst({ select: { patientOnlinePayments: true } });
  return settings?.patientOnlinePayments ?? true;
}

async function page(ctx: TenantContext, tx: TenantTx): Promise<ClinicSettingsPage> {
  const clinic = await tx.clinic.findUnique({ where: { id: ctx.clinicId }, select: { name: true, code: true } });
  if (!clinic) throw new AuthError("NOT_FOUND");
  return { clinic, settings: await loadClinicSettings(tx, ctx.clinicId), defaultInvoicePrefix: `${clinic.code}-INV-`, canEdit: canEdit(ctx) };
}

/** Any active staff member (bills and prescriptions are printed with the branding; booking screens use the timings). */
export async function getClinicSettings(ctx: TenantContext, db?: TenantTx): Promise<ClinicSettingsPage> {
  return runScoped(ctx, db, (tx) => page(ctx, tx));
}

export async function updateClinicSettings(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<ClinicSettingsPage> {
  requirePermission(ctx, SETTINGS_MANAGE);
  if (ctx.branchId) throw new AuthError("FORBIDDEN");
  const { settings, clinic } = toDbPatch(clinicSettingsPatchSchema.parse(raw));
  try {
    return await runScoped(ctx, db, async (tx) => {
      if (Object.keys(settings).length > 0) {
        const updated = await tx.clinicSettings.updateMany({ where: { clinicId: ctx.clinicId }, data: settings as Prisma.ClinicSettingsUpdateManyMutationInput });
        if (updated.count !== 1) throw new AuthError("FORBIDDEN");
      }
      if (clinic.brandColor !== undefined) await tx.clinic.update({ where: { id: ctx.clinicId }, data: { brandColor: clinic.brandColor }, select: { id: true } });
      return page(ctx, tx);
    });
  } catch (err) {
    // The database's own checks (clinic_settings constraints) have the last word.
    if (/violates check constraint|23514/.test(errorText(err))) throw new DataError("INVALID_INPUT", "Some of these settings aren't valid. Check the values and try again.");
    throw err;
  }
}
