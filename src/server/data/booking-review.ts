import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import { istDayKey } from "@/lib/ist";
import type { BookingRequest, BookingRequestPage } from "@/lib/live-types";
import { appointmentTypeToUi, type DbAppointmentType } from "./mappers";
import { runScoped } from "./scope";
import { refundBookingFees } from "./online-payments";

// Reception's queue of patient self-booked requests (status PENDING_APPROVAL)
// and the approve / reject decisions. Listing runs under the existing
// appointments RLS (clinic + branch scope, appointment.view). Decisions go
// through app.approve_patient_booking / app.reject_patient_booking, which
// re-check the permission, the clinic and branch scope, the state and (for
// approval) the slot under the shared slot lock, and record who decided when.
// Nothing here trusts an id or role from the browser beyond the appointment id.

export const BOOKING_REVIEW = ["appointment.update"] as const;
const MAX_QUEUE = 100;

const uuid = z.string().uuid();
export const rejectBookingSchema = z.object({ reason: z.string().trim().min(3, "Give the patient a short reason").max(300) }).strict();
export const reviewQuerySchema = z.object({ branchId: uuid.optional() });

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  NOT_PENDING: ["INVALID_TRANSITION", "This request was already handled or changed by someone else. The list has been refreshed."],
  EXPIRED: ["EXPIRED", "The requested time has already passed. Decline the request and contact the patient for a new time."],
  UNAVAILABLE: ["CONFLICT", "The doctor, branch or patient record is no longer active, so this request can't be approved. Decline it and contact the patient."],
  SLOT_TAKEN: ["SLOT_TAKEN", "That slot is already taken by another appointment. Decline this request and offer the patient another time."],
  PATIENT_CONFLICT: ["CONFLICT", "The patient already has another appointment at this time. Decline this request or contact the patient."],
  INVALID_INPUT: ["INVALID_INPUT", "Give the patient a short reason (3–300 characters)."],
};

/** Database refusals ('booking review: CODE') as API errors. */
function mapReviewError(err: unknown): never {
  const parts: string[] = [];
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if (e instanceof Error) parts.push(e.message);
    const meta = (e as { meta?: unknown }).meta;
    if (meta) parts.push(JSON.stringify(meta));
  }
  const code = /booking review: ([A-Z_]+)/.exec(parts.join(" | "))?.[1];
  if (code === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  if (code === "NOT_FOUND") throw new AuthError("NOT_FOUND");
  const mapped = code ? MESSAGES[code] : undefined;
  if (mapped) throw new DataError(mapped[0], mapped[1]);
  throw err;
}

type Row = {
  id: string; branchId: string; patientId: string; doctorId: string; startsAt: Date; durationMinutes: number; type: DbAppointmentType;
  reason: string; createdAt: Date; updatedAt: Date;
  patient: { name: string; patientNumber: string } | null;
  branch: { name: string } | null;
  doctor: { user: { name: string }; specialty: { name: string } | null } | null;
  _count: { symptomReports: number };
  onlineOrders: { amountPaise: number }[];
};

const select = {
  id: true, branchId: true, patientId: true, doctorId: true, startsAt: true, durationMinutes: true, type: true, reason: true, createdAt: true, updatedAt: true,
  patient: { select: { name: true, patientNumber: true } },
  branch: { select: { name: true } },
  doctor: { select: { user: { select: { name: true } }, specialty: { select: { name: true } } } },
  _count: { select: { symptomReports: true } },
  onlineOrders: { where: { purpose: "BOOKING_FEE" as const, status: "PAID" as const }, select: { amountPaise: true } },
} as const;

const toUi = (r: Row, now: Date): BookingRequest => {
  const key = istDayKey(r.startsAt);
  return {
    id: r.id,
    patientId: r.patientId,
    patientName: r.patient?.name ?? "—",
    patientNumber: r.patient?.patientNumber ?? null,
    doctorId: r.doctorId,
    doctorName: r.doctor?.user.name ?? "—",
    specialty: r.doctor?.specialty?.name ?? null,
    branchId: r.branchId,
    branchName: r.branch?.name ?? "—",
    date: key.date,
    time: key.time,
    startsAt: r.startsAt.toISOString(),
    type: appointmentTypeToUi(r.type) === "online" ? "online" : "in_person",
    reason: r.reason,
    requestedAt: r.updatedAt.toISOString(),
    hasSymptomReport: r._count.symptomReports > 0,
    expired: r.startsAt.getTime() <= now.getTime(),
    feePaid: r.onlineOrders.length ? r.onlineOrders.reduce((sum, o) => sum + o.amountPaise, 0) / 100 : null,
  };
};

/** Pending requests in the caller's scope, soonest first (expired ones last, for declining). */
export async function listBookingRequests(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<BookingRequestPage> {
  requirePermission(ctx, BOOKING_REVIEW);
  const input = reviewQuerySchema.parse(raw ?? {});
  if (input.branchId && ctx.branchId && input.branchId !== ctx.branchId) throw new AuthError("FORBIDDEN");
  const branchId = input.branchId ?? ctx.branchId ?? undefined;
  return runScoped(ctx, db, async (tx) => {
    const where = { clinicId: ctx.clinicId, status: "PENDING_APPROVAL" as const, ...(branchId ? { branchId } : {}) };
    const [rows, total] = await Promise.all([
      tx.appointment.findMany({ where, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: MAX_QUEUE, select }),
      tx.appointment.count({ where }),
    ]);
    const items = (rows as Row[]).map((r) => toUi(r, now));
    items.sort((a, b) => Number(a.expired) - Number(b.expired) || a.startsAt.localeCompare(b.startsAt));
    return { items, total, canReview: hasAnyPermission(ctx, BOOKING_REVIEW) };
  });
}

async function loadRequest(tx: TenantTx, ctx: TenantContext, id: string) {
  return tx.appointment.findFirst({
    where: { id, clinicId: ctx.clinicId },
    select: { id: true, status: true, approvedAt: true, rejectedAt: true, rejectionReason: true },
  });
}

export interface ReviewResult {
  id: string;
  status: "confirmed" | "rejected";
  decidedAt: string;
  /** Rejected with an online fee paid: refunded now, or pending (staff can retry). */
  feeRefund?: "refunded" | "pending" | null;
}

export async function approveBookingRequest(ctx: TenantContext, id: string, db?: TenantTx): Promise<ReviewResult> {
  requirePermission(ctx, BOOKING_REVIEW);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    try {
      await tx.$executeRaw`SELECT app.approve_patient_booking(${id}::uuid)`;
    } catch (err) {
      mapReviewError(err);
    }
    const row = await loadRequest(tx, ctx, id);
    return { id, status: "confirmed", decidedAt: (row?.approvedAt ?? new Date()).toISOString() };
  });
}

export async function rejectBookingRequest(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<ReviewResult> {
  requirePermission(ctx, BOOKING_REVIEW);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const { reason } = rejectBookingSchema.parse(raw);
  const result = await runScoped(ctx, db, async (tx) => {
    try {
      await tx.$executeRaw`SELECT app.reject_patient_booking(${id}::uuid, ${reason})`;
    } catch (err) {
      mapReviewError(err);
    }
    const row = await loadRequest(tx, ctx, id);
    return { id, status: "rejected" as const, decidedAt: (row?.rejectedAt ?? new Date()).toISOString() };
  });
  // After the decision is committed: an advance fee paid online is owed back.
  // (Skipped when composed into a caller's transaction, e.g. tests.)
  if (db) return result;
  const fees = await refundBookingFees(id, "Booking request declined", { staff: ctx });
  return { ...result, feeRefund: fees.pending ? "pending" : fees.refunded ? "refunded" : null };
}
