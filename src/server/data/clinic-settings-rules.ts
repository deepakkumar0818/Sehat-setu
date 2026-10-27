// Pure rules for the clinic's Settings page: what an administrator may send,
// how a stored row becomes the API shape, and the defaults. The database
// (migration 20261102000000_clinic_settings) re-checks every value with its own
// constraints and is what booking and invoice numbering actually read.
import { z } from "zod";
import { DEFAULT_TIMINGS, SLOT_MINUTES, toMinutes, WEEKDAYS } from "@/lib/clinic-hours";
import type { ClinicSettings, Weekday, WeeklyHours } from "@/lib/live-types";

export const PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "online"] as const;
type UiMethod = (typeof PAYMENT_METHODS)[number];

/** Everything as it was before clinics could change it. */
export const DEFAULT_SETTINGS: ClinicSettings = {
  ...DEFAULT_TIMINGS,
  onlineBookingEnabled: true,
  bookingNeedsApproval: true,
  bookingMinNoticeMinutes: 30,
  bookingMaxDaysAhead: 60,
  bookingMaxUpcoming: 5,
  patientOnlinePayments: true,
  invoicePrefix: null,
  gstin: null,
  defaultTaxPercent: 0,
  invoiceFooter: null,
  paymentMethods: [...PAYMENT_METHODS],
  logoDataUrl: null,
  brandColor: null,
  website: null,
  registrationNumber: null,
};

/** Logos are stored inline; ~220 KB of image fits the database limit of 300 000 characters. */
export const MAX_LOGO_CHARS = 300_000;

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use a time like 09:30.").refine((t) => toMinutes(t) % 5 === 0, "Use 5-minute steps.");
const dayHours = z
  .object({ open: hhmm, close: hhmm })
  .strict()
  .refine((d) => toMinutes(d.open) < toMinutes(d.close), "Closing time must be after opening time.")
  .nullable();
const weeklyHours = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayHours])) as Record<Weekday, typeof dayHours>).strict();
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v ? v : null));
const upperOrNull = (re: RegExp, message: string) =>
  z.string().trim().toUpperCase().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || re.test(v), message);

export const clinicSettingsPatchSchema = z
  .object({
    weeklyHours,
    breakStart: hhmm.nullable(),
    breakEnd: hhmm.nullable(),
    slotMinutes: z
      .number()
      .refine((n): n is ClinicSettings["slotMinutes"] => (SLOT_MINUTES as readonly number[]).includes(n), "Choose 10, 15, 20, 30, 45 or 60 minutes."),
    onlineBookingEnabled: z.boolean(),
    bookingNeedsApproval: z.boolean(),
    bookingMinNoticeMinutes: z.number().int().min(0).max(2880),
    bookingMaxDaysAhead: z.number().int().min(1).max(180),
    bookingMaxUpcoming: z.number().int().min(1).max(20),
    patientOnlinePayments: z.boolean(),
    invoicePrefix: upperOrNull(/^[A-Z0-9][A-Z0-9/-]{0,11}$/, "Use up to 12 letters, digits, / or -, starting with a letter or digit."),
    gstin: upperOrNull(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5."),
    defaultTaxPercent: z.number().int().min(0).max(28),
    invoiceFooter: optionalText(500),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, "Keep at least one payment method.").transform((m) => PAYMENT_METHODS.filter((x) => m.includes(x))),
    logoDataUrl: z
      .string()
      .max(MAX_LOGO_CHARS, "The logo is too large. Use an image under 200 KB.")
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Use a PNG, JPEG or WebP image.")
      .nullable(),
    brandColor: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Use a colour like #0f766e.").nullable(),
    website: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
      .refine((v) => v === null || (v.length <= 200 && /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v)), "Enter a website like www.example.in."),
    registrationNumber: optionalText(60),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change")
  .refine((v) => (v.breakStart === undefined) === (v.breakEnd === undefined), "Send the break's start and end together.")
  .refine((v) => (v.breakStart === null) === (v.breakEnd === null), "Set both the break's start and end, or neither.")
  .refine((v) => !v.breakStart || !v.breakEnd || toMinutes(v.breakStart) < toMinutes(v.breakEnd), "The break must end after it starts.");
export type ClinicSettingsPatch = z.infer<typeof clinicSettingsPatchSchema>;

const toDbMethod = (m: UiMethod) => m.toUpperCase();
const toUiMethod = (m: string) => m.toLowerCase() as UiMethod;

export interface ClinicSettingsRow {
  weeklyHours: unknown;
  breakStart: string | null;
  breakEnd: string | null;
  slotMinutes: number;
  onlineBookingEnabled: boolean;
  bookingNeedsApproval: boolean;
  bookingMinNoticeMinutes: number;
  bookingMaxDaysAhead: number;
  bookingMaxUpcoming: number;
  patientOnlinePayments: boolean;
  invoicePrefix: string | null;
  gstin: string | null;
  defaultTaxPercent: number;
  invoiceFooter: string | null;
  paymentMethods: string[];
  logoDataUrl: string | null;
  website: string | null;
  registrationNumber: string | null;
}

/** The stored row (or none: the defaults) as the API shape. brandColor lives on the clinic. */
export function toClinicSettings(row: ClinicSettingsRow | null, brandColor: string | null): ClinicSettings {
  if (!row) return { ...DEFAULT_SETTINGS, brandColor };
  return {
    weeklyHours: row.weeklyHours as WeeklyHours,
    breakStart: row.breakStart,
    breakEnd: row.breakEnd,
    slotMinutes: row.slotMinutes as ClinicSettings["slotMinutes"],
    onlineBookingEnabled: row.onlineBookingEnabled,
    bookingNeedsApproval: row.bookingNeedsApproval,
    bookingMinNoticeMinutes: row.bookingMinNoticeMinutes,
    bookingMaxDaysAhead: row.bookingMaxDaysAhead,
    bookingMaxUpcoming: row.bookingMaxUpcoming,
    patientOnlinePayments: row.patientOnlinePayments,
    invoicePrefix: row.invoicePrefix,
    gstin: row.gstin,
    defaultTaxPercent: row.defaultTaxPercent,
    invoiceFooter: row.invoiceFooter,
    paymentMethods: row.paymentMethods.map(toUiMethod),
    logoDataUrl: row.logoDataUrl,
    brandColor,
    website: row.website,
    registrationNumber: row.registrationNumber,
  };
}

/** The patch split into the settings row's columns and the clinic's own (brandColor). */
export function toDbPatch(patch: ClinicSettingsPatch): { settings: Record<string, unknown>; clinic: { brandColor?: string | null } } {
  const { brandColor, paymentMethods, weeklyHours, ...rest } = patch;
  return {
    settings: { ...rest, ...(paymentMethods && { paymentMethods: paymentMethods.map(toDbMethod) }), ...(weeklyHours && { weeklyHours }) },
    clinic: brandColor !== undefined ? { brandColor } : {},
  };
}

/** Whether reception may record a payment by this method (UI value, e.g. "bank_transfer"). */
export const acceptsMethod = (settings: Pick<ClinicSettings, "paymentMethods">, method: string) => settings.paymentMethods.includes(method as UiMethod);
