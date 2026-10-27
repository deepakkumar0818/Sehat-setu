import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import type { Identity } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { withUserDb } from "@/server/db/tenant";
import { emailSendingConfigured, sendInvitationEmail, type DeliveryResult } from "@/server/supabase-admin";
import type {
  PlatformActivityPage,
  PlatformClinic,
  PlatformClinicCreated,
  PlatformClinicDetail,
  PlatformLedgerPayment,
  PlatformOverview,
  PlatformPaymentsPage,
  PlatformPaymentTotals,
  PlatformSettingsInfo,
  PlatformPlan,
  PlatformSubscription,
  SubscriptionPayment,
} from "@/lib/live-types";
import { errorText } from "./document-rules";
import { istToday, monthlyValue, subscriptionState } from "./platform-rules";

// The Sehat Setu super admin console (migrations 20261103000000_platform_admin
// and 20261104000000_platform_subscriptions): every clinic with its usage
// counts and subscription, one clinic in detail, adding and editing clinics and
// their administrators, suspending or reactivating one, plans, the payments
// clinics make to Sehat Setu, and the activity log. The caller is a verified,
// ACTIVE super admin (requirePlatformAdmin); each database function re-checks
// that for the pinned session before doing anything. No patient, clinical or
// billing record is read here.

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const email = z.string().trim().toLowerCase().email().max(254);

export const createClinicSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "Use 2–10 letters or digits, e.g. SUN."),
    name: text(2, 120),
    email,
    phone: z.string().trim().regex(/^\+?[0-9][0-9 -]{6,18}[0-9]$/, "Enter a valid phone number."),
    addressLine: text(1, 300),
    city: text(1, 80),
    state: text(1, 80),
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code."),
    branchName: z.string().trim().max(120).optional().default(""),
    adminName: text(2, 120),
    adminEmail: email,
  })
  .strict();

export const clinicStatusSchema = z.object({ status: z.enum(["active", "suspended"]) }).strict();

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  INVALID_INPUT: ["INVALID_INPUT", "Please check the clinic's details."],
  DUPLICATE_CODE: ["DUPLICATE", "Another clinic already uses that code. Choose a different one."],
  ADMIN_DISABLED: ["INVALID_INPUT", "That administrator's account is disabled. Use a different email."],
  ALREADY_ADMIN: ["DUPLICATE", "That person is already an administrator of this clinic."],
  LAST_ADMIN: ["INVALID_TRANSITION", "A clinic needs at least one administrator. Add the new administrator first, then remove this one."],
  DUPLICATE_PLAN: ["DUPLICATE", "Another plan already uses that key."],
  NO_SUBSCRIPTION: ["INVALID_TRANSITION", "Choose a plan for this clinic before recording a payment."],
  ALREADY_VOIDED: ["INVALID_TRANSITION", "That payment has already been voided."],
  NOT_LATEST: ["INVALID_TRANSITION", "Only the most recent payment can be voided. Void the later ones first."],
};

function mapPlatformError(err: unknown): never {
  const m = /platform: ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  if (m[1] === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (m[1] === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const known = MESSAGES[m[1]];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

/** Runs as the super admin's own session (user and login pinned, no clinic). */
async function asPlatform<T>(identity: Identity, fn: Parameters<typeof withUserDb<T>>[1]): Promise<T> {
  try {
    return await withUserDb(identity, fn);
  } catch (err) {
    mapPlatformError(err);
  }
}

const uuid = z.string().uuid();
const requireId = (id: string) => {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
};
const lower = <T extends string>(v: T) => v.toLowerCase() as Lowercase<T>;

type RawStatus = "ACTIVE" | "SUSPENDED" | "PENDING";

type RawSubscription = {
  planId: string;
  planKey: string;
  planName: string;
  billingCycle: "MONTHLY" | "YEARLY";
  pricePaise: number;
  paidUntil: string;
  autoSuspend: boolean;
  graceDays: number;
  suspendedForNonPayment: boolean;
  notes: string | null;
  maxBranches: number | null;
  maxDoctors: number | null;
  maxStaff: number | null;
};

function toSubscription(s: RawSubscription | null, today: string): PlatformSubscription | null {
  if (!s) return null;
  return {
    planId: s.planId,
    planKey: s.planKey,
    planName: s.planName,
    billingCycle: lower(s.billingCycle),
    price: s.pricePaise / 100,
    paidUntil: s.paidUntil,
    ...subscriptionState(s.planKey, s.paidUntil, today),
    autoSuspend: s.autoSuspend,
    graceDays: s.graceDays,
    suspendedForNonPayment: s.suspendedForNonPayment,
    notes: s.notes,
    limits: { branches: s.maxBranches, doctors: s.maxDoctors, staff: s.maxStaff },
  };
}

type RawClinic = Omit<PlatformClinic, "status" | "revenueThisMonth" | "admins" | "subscription" | "subscriptionCollectedThisMonth"> & {
  status: RawStatus;
  revenueThisMonthPaise: number;
  subscriptionCollectedThisMonthPaise: number;
  subscription: RawSubscription | null;
  admins: { userId: string; name: string; email: string; status: "ACTIVE" | "INVITED" | "DISABLED" }[];
};

const toClinic =
  (today: string) =>
  ({ revenueThisMonthPaise, subscriptionCollectedThisMonthPaise, subscription, status, admins, ...c }: RawClinic): PlatformClinic => ({
    ...c,
    status: lower(status),
    revenueThisMonth: revenueThisMonthPaise / 100,
    subscription: toSubscription(subscription, today),
    subscriptionCollectedThisMonth: subscriptionCollectedThisMonthPaise / 100,
    admins: admins.map((a) => ({ ...a, status: lower(a.status) })),
  });

/** Every clinic. First suspends any clinic with auto-suspend on that is past its grace days. */
export async function getPlatformOverview(identity: Identity): Promise<PlatformOverview> {
  const today = istToday();
  const { clinics, autoSuspended } = await asPlatform(identity, async (tx) => {
    const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT app.platform_enforce_subscriptions() AS n`;
    const [row] = await tx.$queryRaw<{ o: RawClinic[] }[]>`SELECT app.platform_clinic_overview() AS o`;
    return { clinics: row.o.map(toClinic(today)), autoSuspended: n };
  });
  const sum = (k: "doctors" | "patients" | "staff" | "appointmentsThisMonth" | "revenueThisMonth" | "subscriptionCollectedThisMonth") =>
    clinics.reduce((s, c) => s + c[k], 0);
  const active = clinics.filter((c) => c.status === "active");
  return {
    clinics,
    totals: {
      clinics: clinics.length,
      activeClinics: active.length,
      doctors: sum("doctors"),
      staff: sum("staff"),
      patients: sum("patients"),
      appointmentsThisMonth: sum("appointmentsThisMonth"),
      revenueThisMonth: sum("revenueThisMonth"),
      mrr: Math.round(active.reduce((s, c) => s + monthlyValue(c.subscription), 0) * 100) / 100,
      subscriptionCollectedThisMonth: sum("subscriptionCollectedThisMonth"),
      overdue: active.filter((c) => c.subscription?.state === "overdue").length,
      dueSoon: active.filter((c) => c.subscription?.state === "due_soon").length,
    },
    autoSuspended,
  };
}

type RawPayment = Omit<SubscriptionPayment, "amount" | "method"> & { amountPaise: number; method: Uppercase<SubscriptionPayment["method"]> };
const toPayment = ({ amountPaise, method, ...p }: RawPayment): SubscriptionPayment => ({ ...p, amount: amountPaise / 100, method: lower(method) });

type Person = PlatformClinicDetail["people"][number];
type RawDetail = Omit<PlatformClinicDetail, "status" | "subscription" | "branches" | "people" | "usage" | "payments"> & {
  status: RawStatus;
  subscription: RawSubscription | null;
  branches: (Omit<PlatformClinicDetail["branches"][number], "status"> & { status: "ACTIVE" | "INACTIVE" })[];
  people: (Omit<Person, "status" | "accountStatus" | "roles"> & { status: "ACTIVE" | "INACTIVE"; accountStatus: "ACTIVE" | "INVITED" | "DISABLED"; roles: string[] | null })[];
  usage: { month: string; appointments: number; newPatients: number; collectedPaise: number }[];
  payments: RawPayment[];
};

/** One clinic: details, subscription and payments, branches, people (names and roles), and 6 months of usage. */
export async function getPlatformClinic(identity: Identity, id: string): Promise<PlatformClinicDetail> {
  requireId(id);
  const today = istToday();
  const d = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ d: RawDetail }[]>`SELECT app.platform_clinic_detail(${id}::uuid) AS d`;
    return row.d;
  });
  return {
    ...d,
    status: lower(d.status),
    subscription: toSubscription(d.subscription, today),
    branches: d.branches.map((b) => ({ ...b, status: lower(b.status) })),
    people: d.people.map((p) => ({ ...p, status: lower(p.status), accountStatus: lower(p.accountStatus), roles: p.roles ?? [] })),
    usage: d.usage.map(({ collectedPaise, ...u }) => ({ ...u, collected: collectedPaise / 100 })),
    payments: d.payments.map(toPayment),
  };
}

const DELIVERY_TEXT: Record<string, string> = {
  not_configured: "Email sending isn't set up on the server, so no invitation was sent.",
  rate_limited: "Too many emails were sent recently. Resend the invitation in a few minutes.",
};
const deliveryText = (d: DeliveryResult) => (d.ok ? null : (DELIVERY_TEXT[d.error] ?? "The invitation email couldn't be sent. Try resending it."));

/** Adds a clinic, then emails its administrator an invitation to sign in (after the clinic is saved). */
export async function createPlatformClinic(identity: Identity, raw: unknown): Promise<PlatformClinicCreated> {
  const input = createClinicSchema.parse(raw);
  const created = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ clinic_id: string; admin_is_new: boolean }[]>`
      SELECT clinic_id::text, admin_is_new FROM app.platform_create_clinic(
        ${input.code}, ${input.name}, ${input.email}, ${input.phone}, ${input.addressLine}, ${input.city}, ${input.state}, ${input.pincode},
        ${input.branchName}, ${input.adminName}, ${input.adminEmail})`;
    return row;
  });
  const delivery = await sendInvitationEmail(input.adminEmail);
  return { clinicId: created.clinic_id, adminEmail: input.adminEmail, adminIsNew: created.admin_is_new, invitationSent: delivery.ok, invitationProblem: deliveryText(delivery) };
}

export async function setPlatformClinicStatus(identity: Identity, id: string, raw: unknown): Promise<{ ok: true }> {
  requireId(id);
  const { status } = clinicStatusSchema.parse(raw);
  await asPlatform(identity, (tx) => tx.$executeRaw`SELECT app.platform_set_clinic_status(${id}::uuid, ${status.toUpperCase()})`);
  return { ok: true };
}

export const clinicProfileSchema = createClinicSchema.pick({ name: true, email: true, phone: true, addressLine: true, city: true, state: true, pincode: true }).strict();

/** The clinic's name, contact details and address (its code never changes). */
export async function updatePlatformClinic(identity: Identity, id: string, raw: unknown): Promise<{ ok: true }> {
  requireId(id);
  const c = clinicProfileSchema.parse(raw);
  await asPlatform(identity, (tx) => tx.$executeRaw`
    SELECT app.platform_update_clinic(${id}::uuid, ${c.name}, ${c.email}, ${c.phone}, ${c.addressLine}, ${c.city}, ${c.state}, ${c.pincode})`);
  return { ok: true };
}

/** Re-sends the sign-in invitation to a clinic administrator who hasn't signed in yet. */
export async function resendClinicAdminInvite(identity: Identity, clinicId: string, raw: unknown): Promise<{ sent: boolean; problem: string | null }> {
  const { email: adminEmail } = z.object({ email }).strict().parse(raw);
  const { clinics } = await getPlatformOverview(identity);
  const admin = clinics.find((c) => c.id === clinicId)?.admins.find((a) => a.email.toLowerCase() === adminEmail);
  // Only an administrator of that clinic who hasn't signed in yet.
  if (!admin) throw new AuthError("NOT_FOUND");
  if (admin.status !== "invited") throw new DataError("INVALID_INPUT", "This administrator has already signed in.");
  const delivery = await sendInvitationEmail(adminEmail);
  return { sent: delivery.ok, problem: deliveryText(delivery) };
}

export const clinicAdminSchema = z.object({ name: text(2, 120), email }).strict();

/** Makes someone an administrator of the clinic; if they haven't signed in yet, they're emailed an invitation. */
export async function addPlatformClinicAdmin(identity: Identity, id: string, raw: unknown): Promise<{ adminIsNew: boolean; invitationSent: boolean | null; invitationProblem: string | null }> {
  requireId(id);
  const input = clinicAdminSchema.parse(raw);
  const added = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ admin_is_new: boolean; signed_in: boolean }[]>`
      SELECT admin_is_new, admin_signed_in AS signed_in FROM app.platform_add_clinic_admin(${id}::uuid, ${input.name}, ${input.email})`;
    return row;
  });
  // Someone who already signs in sees the clinic next time; nothing to send.
  if (added.signed_in) return { adminIsNew: false, invitationSent: null, invitationProblem: null };
  const delivery = await sendInvitationEmail(input.email);
  return { adminIsNew: added.admin_is_new, invitationSent: delivery.ok, invitationProblem: deliveryText(delivery) };
}

/** Takes the administrator role away from someone (never the clinic's last administrator). */
export async function removePlatformClinicAdmin(identity: Identity, id: string, userId: string): Promise<{ ok: true }> {
  requireId(id);
  requireId(userId);
  await asPlatform(identity, (tx) => tx.$executeRaw`SELECT app.platform_remove_clinic_admin(${id}::uuid, ${userId}::uuid)`);
  return { ok: true };
}

// --- Plans -----------------------------------------------------------------

/** Rupees in, paise out. */
const rupees = (min: number, max: number) => z.number().finite().min(min).max(max).transform((v) => Math.round(v * 100));
const limit = (max: number) => z.number().int().min(1).max(max).nullable();

export const planSchema = z
  .object({
    key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/, "Use 2–30 capital letters, digits or _, e.g. PRO.").optional(),
    name: text(2, 60),
    monthlyPrice: rupees(0, 1_000_000),
    yearlyPrice: rupees(0, 10_000_000),
    maxBranches: limit(1000),
    maxDoctors: limit(10000),
    maxStaff: limit(10000),
    isActive: z.boolean(),
  })
  .strict();

type RawPlan = Omit<PlatformPlan, "monthlyPrice" | "yearlyPrice"> & { monthlyPricePaise: number; yearlyPricePaise: number };

export async function listPlatformPlans(identity: Identity): Promise<PlatformPlan[]> {
  const plans = await asPlatform(identity, async (tx) => (await tx.$queryRaw<{ p: RawPlan[] }[]>`SELECT app.platform_plans() AS p`)[0].p);
  return plans.map(({ monthlyPricePaise, yearlyPricePaise, ...p }) => ({ ...p, monthlyPrice: monthlyPricePaise / 100, yearlyPrice: yearlyPricePaise / 100 }));
}

/** A new plan (id null, key required) or changes to one (its key never changes). */
export async function savePlatformPlan(identity: Identity, id: string | null, raw: unknown): Promise<{ id: string }> {
  if (id !== null) requireId(id);
  const p = planSchema.parse(raw);
  if (id === null && !p.key) throw new DataError("INVALID_INPUT", "Give the new plan a key, e.g. PRO.");
  return asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT app.platform_save_plan(${id}::uuid, ${p.key ?? null}, ${p.name}, ${p.monthlyPrice}::int, ${p.yearlyPrice}::int,
        ${p.maxBranches}::int, ${p.maxDoctors}::int, ${p.maxStaff}::int, ${p.isActive})::text AS id`;
    return { id: row.id };
  });
}

// --- A clinic's subscription and payments -------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31.")
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "Not a real date.");

export const subscriptionSchema = z
  .object({
    planId: uuid,
    billingCycle: z.enum(["monthly", "yearly"]),
    price: rupees(0, 10_000_000),
    paidUntil: isoDate,
    autoSuspend: z.boolean(),
    graceDays: z.number().int().min(0).max(90),
    notes: z.string().trim().max(1000).optional().default(""),
  })
  .strict();

/** Plan, billing cycle, agreed price, paid-until date and auto-suspend for a clinic. */
export async function setPlatformSubscription(identity: Identity, id: string, raw: unknown): Promise<{ ok: true }> {
  requireId(id);
  const s = subscriptionSchema.parse(raw);
  await asPlatform(identity, (tx) => tx.$executeRaw`
    SELECT app.platform_set_subscription(${id}::uuid, ${s.planId}::uuid, ${s.billingCycle.toUpperCase()}, ${s.price}::int, ${s.paidUntil}::date,
      ${s.autoSuspend}, ${s.graceDays}::int, ${s.notes})`);
  return { ok: true };
}

export const subscriptionPaymentSchema = z
  .object({
    amount: rupees(1, 10_000_000),
    method: z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]),
    reference: z.string().trim().max(120).optional().default(""),
    paidOn: isoDate,
    months: z.number().int().min(1).max(36),
    notes: z.string().trim().max(500).optional().default(""),
  })
  .strict();

/** Money the clinic paid Sehat Setu; extends paid-until (and reactivates a clinic auto-suspended for non-payment). */
export async function recordSubscriptionPayment(identity: Identity, id: string, raw: unknown): Promise<{ paymentId: string; paidUntil: string; reactivated: boolean }> {
  requireId(id);
  const p = subscriptionPaymentSchema.parse(raw);
  if (p.paidOn > istToday()) throw new DataError("INVALID_INPUT", "The payment date can't be in the future.");
  return asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ payment_id: string; paid_until: string; reactivated: boolean }[]>`
      SELECT payment_id::text, paid_until::text, reactivated FROM app.platform_record_subscription_payment(
        ${id}::uuid, ${p.amount}::int, ${p.method.toUpperCase()}, ${p.reference}, ${p.paidOn}::date, ${p.months}::int, ${p.notes})`;
    return { paymentId: row.payment_id, paidUntil: row.paid_until, reactivated: row.reactivated };
  });
}

export const voidPaymentSchema = z.object({ reason: text(3, 300) }).strict();

/** Voids the clinic's latest payment (recorded by mistake); paid-until goes back. */
export async function voidSubscriptionPayment(identity: Identity, id: string, paymentId: string, raw: unknown): Promise<{ paidUntil: string }> {
  requireId(id);
  requireId(paymentId);
  const { reason } = voidPaymentSchema.parse(raw);
  return asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ d: string }[]>`SELECT app.platform_void_subscription_payment(${id}::uuid, ${paymentId}::uuid, ${reason})::text AS d`;
    return { paidUntil: row.d };
  });
}

// --- Activity log ----------------------------------------------------------

export const activityQuerySchema = z.object({
  clinicId: uuid.optional(),
  kind: z.enum(["all", "platform", "problems"]).optional().default("all"),
  before: z.string().datetime({ offset: true }).optional(),
});

const PAGE = 50; // fixed in app.platform_activity
type RawEvent = Omit<PlatformActivityPage["events"][number], "outcome"> & { outcome: "SUCCESS" | "DENIED" | "FAILURE" };

/** Platform actions, plus refusals and failures anywhere, newest first. */
export async function getPlatformActivity(identity: Identity, raw: unknown): Promise<PlatformActivityPage> {
  const q = activityQuerySchema.parse(raw);
  const events = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ a: RawEvent[] }[]>`
      SELECT app.platform_activity(${q.clinicId ?? null}::uuid, ${q.kind}, ${q.before ?? null}::timestamptz) AS a`;
    return row.a.map((e) => ({ ...e, outcome: lower(e.outcome) }));
  });
  return { events, nextBefore: events.length === PAGE ? events[events.length - 1].occurredAt : null };
}

// --- Payments ledger and settings (migration 20261105000000_platform_payments_ledger) ---

export const paymentsQuerySchema = z.object({
  clinicId: uuid.optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

/** Every clinic's payments to Sehat Setu, newest recorded first, 50 at a time. */
export async function getPlatformPayments(identity: Identity, raw: unknown): Promise<PlatformPaymentsPage> {
  const q = paymentsQuerySchema.parse(raw);
  const payments = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ p: (RawPayment & { clinicId: string; clinicName: string; clinicCode: string })[] }[]>`
      SELECT app.platform_payments(${q.clinicId ?? null}::uuid, ${q.before ?? null}::timestamptz) AS p`;
    return row.p.map(({ clinicId, clinicName, clinicCode, ...p }): PlatformLedgerPayment => ({ ...toPayment(p), clinicId, clinicName, clinicCode }));
  });
  return { payments, nextBefore: payments.length === PAGE ? payments[payments.length - 1].createdAt : null };
}

/** Money received per month for the last 12 months. */
export async function getPlatformPaymentTotals(identity: Identity): Promise<PlatformPaymentTotals> {
  const months = await asPlatform(identity, async (tx) => {
    const [row] = await tx.$queryRaw<{ t: { month: string; amountPaise: number; payments: number }[] }[]>`SELECT app.platform_payment_totals() AS t`;
    return row.t;
  });
  return { months: months.map(({ amountPaise, ...m }) => ({ ...m, amount: amountPaise / 100 })) };
}

type RawAdmin = Omit<PlatformSettingsInfo["admins"][number], "status"> & { status: "ACTIVE" | "INVITED" | "DISABLED" };

/** For the Settings page: who has super admin access, and whether invitation emails can be sent. */
export async function getPlatformSettings(identity: Identity): Promise<PlatformSettingsInfo> {
  const admins = await asPlatform(identity, async (tx) => (await tx.$queryRaw<{ a: RawAdmin[] }[]>`SELECT app.platform_admin_list() AS a`)[0].a);
  return { admins: admins.map((a) => ({ ...a, status: lower(a.status) })), emailConfigured: emailSendingConfigured() };
}
