import "server-only";
import { z } from "zod";
import { AuthError } from "@/server/auth/errors";
import { appointmentScopeFilter, assertBranchAccess, assertRecordAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import { DataError } from "@/server/api/errors";
import { istDayKey, istDayRange, istMonthStart } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { BillingSummary, InvoiceWithNames } from "@/services/billing";
import type { Payment } from "@/types";
import {
  assertPayable,
  BillingRuleError,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  invoiceStatusFromUi,
  invoiceStatusToUi,
  lineCategoryFromUi,
  lineCategoryToUi,
  paidPaise,
  paymentMethodFromUi,
  paymentMethodToUi,
  paymentStatusToUi,
  toRupees,
  type DbInvoiceStatus,
  type DbLineCategory,
  type DbPaymentMethod,
  type DbPaymentStatus,
} from "./billing-math";
import { pageArgs, runScoped, type Page } from "./scope";

// Billing — invoices, line items and manually recorded payments, branch-scoped
// like appointments. Totals and statuses are always computed here from line
// items and SUCCEEDED payments; the client never supplies a total, a status or
// a payment time. Every invoice mutation takes a per-invoice advisory lock, so
// concurrent payments/refunds/voids are serialised and an invoice can't be
// over-paid. RLS (prisma/migrations/*_record_access_and_audit) enforces the
// same visibility and write permissions independently.
//
// There is no payment-gateway integration: payments are recorded by staff
// after the money is received (cash, UPI, card, bank transfer, or an online
// payment taken elsewhere).

export const BILLING_VIEW = ["billing.view", "invoice.view", "billing.manage"] as const;
export const PAYMENT_VIEW = ["billing.view", "invoice.view", "payment.view", "billing.manage"] as const;
export const INVOICE_CREATE = ["invoice.create", "billing.manage"] as const;
export const PAYMENT_CREATE = ["payment.create", "billing.manage"] as const;
const INVOICE_VOID = ["invoice.update", "billing.manage"] as const;
const PAYMENT_REFUND = ["refund.manage", "billing.manage"] as const;

const uuid = z.string().uuid();

const invoiceSelect = {
  id: true, clinicId: true, branchId: true, patientId: true, appointmentId: true, invoiceNumber: true, issuedAt: true,
  subtotalPaise: true, discountPaise: true, taxPaise: true, totalPaise: true, status: true,
  payments: { select: { id: true, amountPaise: true, method: true, status: true, reference: true, paidAt: true }, orderBy: { paidAt: "asc" as const } },
} as const;

type PaymentRow = { id: string; amountPaise: number; method: DbPaymentMethod; status: DbPaymentStatus; reference: string | null; paidAt: Date };
type InvoiceRow = {
  id: string; clinicId: string; branchId: string; patientId: string; appointmentId: string | null; invoiceNumber: string; issuedAt: Date;
  subtotalPaise: number; discountPaise: number; taxPaise: number; totalPaise: number; status: DbInvoiceStatus; payments: PaymentRow[];
};

/** Business-rule failures become 400s with the rule's own message. */
function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BillingRuleError) throw new DataError("INVALID_INPUT", err.message);
    throw err;
  }
}

function branchWhere(ctx: TenantContext, branchId?: string) {
  if (branchId && branchId !== "all") {
    assertBranchAccess(ctx, branchId);
    return { branchId };
  }
  return ctx.branchId ? { branchId: ctx.branchId } : {};
}

function toPayment(p: PaymentRow, invoice: { id: string; invoiceNumber: string; patientId: string }): Payment {
  return {
    id: p.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    patientId: invoice.patientId,
    date: istDayKey(p.paidAt).date,
    paidAt: p.paidAt.toISOString(),
    amount: toRupees(p.amountPaise),
    method: paymentMethodToUi(p.method),
    status: paymentStatusToUi(p.status),
    reference: p.reference ?? undefined,
  };
}

function toUiInvoice(row: InvoiceRow, patientName: string): InvoiceWithNames {
  const paid = paidPaise(row.payments);
  const lastPaid = row.payments.filter((p) => p.status === "SUCCEEDED").at(-1);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    patientId: row.patientId,
    branchId: row.branchId,
    appointmentId: row.appointmentId ?? undefined,
    date: istDayKey(row.issuedAt).date,
    items: [],
    subtotal: toRupees(row.subtotalPaise),
    discount: toRupees(row.discountPaise),
    tax: toRupees(row.taxPaise),
    total: toRupees(row.totalPaise),
    paid: toRupees(paid),
    balance: row.status === "VOID" ? 0 : toRupees(Math.max(0, row.totalPaise - paid)),
    status: invoiceStatusToUi(row.status),
    paymentMethod: lastPaid ? paymentMethodToUi(lastPaid.method) : undefined,
    patientName,
  };
}

/** Patient names resolved separately, so a patient RLS hides degrades to "—" instead of failing the list. */
async function patientNames(tx: TenantTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.patient.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((p) => [p.id, p.name]));
}

// --- reads ---------------------------------------------------------------------

export const listInvoicesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["paid", "partial", "pending", "void", "refunded", "all"]).optional(),
  patientId: uuid.optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listInvoices(ctx: TenantContext, input: z.infer<typeof listInvoicesSchema>, db?: TenantTx): Promise<Page<InvoiceWithNames>> {
  requirePermission(ctx, BILLING_VIEW);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    ...branchWhere(ctx, input.branchId),
    ...(input.status && input.status !== "all" ? { status: { in: invoiceStatusFromUi(input.status) } } : {}),
    ...(input.patientId ? { patientId: input.patientId } : {}),
    ...(search
      ? {
          OR: [
            { invoiceNumber: { contains: search, mode: "insensitive" as const } },
            { patient: { name: { contains: search, mode: "insensitive" as const } } },
            { patient: { patientNumber: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.invoice.findMany({ where, orderBy: [{ issuedAt: "desc" }, { invoiceNumber: "desc" }], skip, take, select: invoiceSelect }),
      tx.invoice.count({ where }),
    ]);
    const names = await patientNames(tx, rows.map((r) => r.patientId));
    return { items: (rows as InvoiceRow[]).map((r) => toUiInvoice(r, names.get(r.patientId) ?? "—")), total, page, pageSize };
  });
}

async function loadInvoice(ctx: TenantContext, tx: TenantTx, id: string): Promise<InvoiceRow> {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const row = await tx.invoice.findFirst({ where: { id, clinicId: ctx.clinicId, ...branchWhere(ctx) }, select: invoiceSelect });
  return assertRecordAccess(ctx, row as InvoiceRow | null);
}

async function invoiceDetail(ctx: TenantContext, tx: TenantTx, row: InvoiceRow): Promise<InvoiceWithNames> {
  const [lines, patient, branch] = await Promise.all([
    tx.invoiceLineItem.findMany({ where: { invoiceId: row.id }, orderBy: { id: "asc" }, select: { description: true, category: true, quantity: true, unitPricePaise: true, amountPaise: true } }),
    tx.patient.findFirst({ where: { id: row.patientId }, select: { name: true, patientNumber: true, phone: true } }),
    tx.branch.findFirst({ where: { id: row.branchId, clinicId: ctx.clinicId }, select: { name: true, addressLine: true, city: true, phone: true } }),
  ]);
  const paid = paidPaise(row.payments);
  const open = row.status !== "VOID";
  return {
    ...toUiInvoice(row, patient?.name ?? "—"),
    items: lines.map((l) => ({
      description: l.description,
      category: lineCategoryToUi(l.category as DbLineCategory),
      quantity: l.quantity,
      unitPrice: toRupees(l.unitPricePaise),
      amount: toRupees(l.amountPaise),
    })),
    patientNumber: patient?.patientNumber,
    patientPhone: patient?.phone,
    branchName: branch?.name,
    branchAddress: branch ? `${branch.addressLine}, ${branch.city}` : undefined,
    branchPhone: branch?.phone,
    payments: row.payments.map((p) => toPayment(p, row)),
    capabilities: {
      recordPayment: open && paid < row.totalPaise && hasAnyPermission(ctx, PAYMENT_CREATE),
      void: open && paid === 0 && hasAnyPermission(ctx, INVOICE_VOID),
      refund: open && hasAnyPermission(ctx, PAYMENT_REFUND),
    },
  };
}

export async function getInvoice(ctx: TenantContext, id: string, db?: TenantTx): Promise<InvoiceWithNames> {
  requirePermission(ctx, BILLING_VIEW);
  return runScoped(ctx, db, async (tx) => invoiceDetail(ctx, tx, await loadInvoice(ctx, tx, id)));
}

export const listPaymentsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  method: z.enum(["cash", "upi", "card", "bank_transfer", "online", "all"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export async function listPayments(ctx: TenantContext, input: z.infer<typeof listPaymentsSchema>, db?: TenantTx): Promise<Page<Payment & { patientName: string }>> {
  requirePermission(ctx, PAYMENT_VIEW);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize);
  const search = input.search?.trim();
  const where = {
    clinicId: ctx.clinicId,
    invoice: branchWhere(ctx),
    ...(input.method && input.method !== "all" ? { method: paymentMethodFromUi(input.method) } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" as const } },
            { invoice: { invoiceNumber: { contains: search, mode: "insensitive" as const } } },
            { invoice: { patient: { name: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.payment.findMany({
        where,
        orderBy: [{ paidAt: "desc" }, { id: "asc" }],
        skip,
        take,
        select: { id: true, amountPaise: true, method: true, status: true, reference: true, paidAt: true, invoice: { select: { id: true, invoiceNumber: true, patientId: true } } },
      }),
      tx.payment.count({ where }),
    ]);
    const names = await patientNames(tx, rows.map((r) => r.invoice.patientId));
    return {
      items: rows.map((r) => ({ ...toPayment(r as PaymentRow, r.invoice), patientName: names.get(r.invoice.patientId) ?? "—" })),
      total,
      page,
      pageSize,
    };
  });
}

/**
 * Revenue = SUCCEEDED payments received in the IST day/month (a refund marks
 * the payment REFUNDED, so it drops out). Outstanding = total − paid over
 * PENDING and PARTIALLY_PAID invoices. Scoped to the user's branch, if any.
 */
export async function getBillingSummary(ctx: TenantContext, db?: TenantTx, now = new Date()): Promise<BillingSummary> {
  requirePermission(ctx, BILLING_VIEW);
  const invoiceScope = { clinicId: ctx.clinicId, ...branchWhere(ctx) };
  const today = istDayRange(now, 0);
  const monthStart = istMonthStart(now);
  const received = (from: Date) => ({ clinicId: ctx.clinicId, status: "SUCCEEDED" as const, paidAt: { gte: from, lt: today.end }, invoice: invoiceScope });
  return runScoped(ctx, db, async (tx) => {
    const [todaySum, monthSum, open] = await Promise.all([
      tx.payment.aggregate({ where: received(today.start), _sum: { amountPaise: true } }),
      tx.payment.aggregate({ where: received(monthStart), _sum: { amountPaise: true } }),
      tx.invoice.findMany({
        where: { ...invoiceScope, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
        select: { totalPaise: true, payments: { where: { status: "SUCCEEDED" }, select: { amountPaise: true, status: true } } },
      }),
    ]);
    return {
      todaysRevenue: toRupees(todaySum._sum.amountPaise ?? 0),
      totalRevenueThisMonth: toRupees(monthSum._sum.amountPaise ?? 0),
      outstandingBalance: toRupees(open.reduce((s, inv) => s + Math.max(0, inv.totalPaise - paidPaise(inv.payments)), 0)),
      totalExpensesThisMonth: null, // no expenses table in the clinic database yet
      canCreateInvoice: hasAnyPermission(ctx, INVOICE_CREATE),
    };
  });
}

// --- writes --------------------------------------------------------------------

/** Serialises every mutation of one invoice (payments, refunds, void) until the transaction ends. */
async function lockInvoice(tx: TenantTx, invoiceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
}

/** Next clinic-wide invoice number (see migration 20261015000000_document_numbers). Same transaction as the insert. */
async function nextInvoiceNumber(tx: TenantTx): Promise<string> {
  const rows = await tx.$queryRaw<{ n: string }[]>`SELECT app.next_document_number('invoice') AS n`;
  return rows[0].n;
}

/** Financial audit event, written in the same transaction as the change it describes. No patient details. */
async function logBilling(tx: TenantTx, action: string, invoiceId: string, metadata: Record<string, string | number>) {
  await tx.$executeRaw`SELECT app.log_event(${action}, 'SUCCESS', 'invoice', ${invoiceId}, NULL, NULL, NULL, ${JSON.stringify(metadata)}::jsonb)`;
}

const VISIT_LABEL: Record<string, string> = { IN_PERSON: "In-person", ONLINE: "Online", FOLLOW_UP: "Follow-up", WALK_IN: "Walk-in" };

/**
 * Invoice for an appointment's consultation, at the doctor's fee. Idempotent:
 * an appointment has at most one invoice, and asking again returns it.
 */
export async function createInvoiceForAppointment(ctx: TenantContext, appointmentId: string, db?: TenantTx, now = new Date()): Promise<InvoiceWithNames> {
  requirePermission(ctx, INVOICE_CREATE);
  if (!uuid.safeParse(appointmentId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-appointment:${appointmentId}`}))`;
    const appt = assertRecordAccess(
      ctx,
      await tx.appointment.findFirst({
        where: { id: appointmentId, clinicId: ctx.clinicId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}), ...appointmentScopeFilter(ctx) },
        select: { id: true, clinicId: true, branchId: true, patientId: true, status: true, type: true, doctor: { select: { consultationFeePaise: true } } },
      })
    );
    const existing = await tx.invoice.findFirst({ where: { clinicId: ctx.clinicId, appointmentId }, select: invoiceSelect });
    if (existing) {
      if (existing.status === "VOID") throw new DataError("INVALID_TRANSITION", "This appointment's invoice was voided. Create a manual invoice instead.");
      return invoiceDetail(ctx, tx, existing as InvoiceRow);
    }
    if (appt.status === "CANCELLED") throw new DataError("INVALID_TRANSITION", "A cancelled appointment can't be invoiced.");

    const fee = appt.doctor.consultationFeePaise;
    const totals = rule(() => computeInvoiceTotals([{ quantity: 1, unitPricePaise: fee }], 0, 0));
    const invoiceNumber = await nextInvoiceNumber(tx);
    const created = await tx.invoice.create({
      data: {
        clinicId: ctx.clinicId,
        branchId: appt.branchId,
        patientId: appt.patientId,
        appointmentId,
        invoiceNumber,
        issuedAt: now,
        subtotalPaise: totals.subtotalPaise,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: totals.totalPaise,
        status: deriveInvoiceStatus("PENDING", totals.totalPaise, 0),
        lineItems: {
          create: [{ description: `Consultation — ${VISIT_LABEL[appt.type] ?? "Visit"}`, category: "CONSULTATION", quantity: 1, unitPricePaise: fee, amountPaise: fee }],
        },
      },
      select: invoiceSelect,
    });
    await logBilling(tx, "billing.invoice_created", created.id, { invoiceNumber, totalPaise: totals.totalPaise, source: "appointment" });
    return invoiceDetail(ctx, tx, created as InvoiceRow);
  });
}

export const createManualInvoiceSchema = z.object({
  patientId: uuid,
  branchId: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        category: z.enum(["consultation", "medicine", "lab_test", "procedure", "other"]),
        quantity: z.number().int(),
        unitPricePaise: z.number().int(),
      })
    )
    .min(1),
  discountPaise: z.number().int().default(0),
  taxRatePercent: z.number().default(0),
});

export async function createManualInvoice(ctx: TenantContext, raw: unknown, db?: TenantTx, now = new Date()): Promise<InvoiceWithNames> {
  requirePermission(ctx, INVOICE_CREATE);
  const input = createManualInvoiceSchema.parse(raw);
  const totals = rule(() => computeInvoiceTotals(input.items, input.discountPaise, input.taxRatePercent));
  return runScoped(ctx, db, async (tx) => {
    const patient = await tx.patient.findFirst({ where: { id: input.patientId, clinicId: ctx.clinicId }, select: { id: true, branchId: true, status: true } });
    if (!patient || patient.status === "ARCHIVED") throw new DataError("INVALID_INPUT", "Choose an active patient of your clinic.");
    const branchId = (input.branchId && input.branchId !== "all" ? input.branchId : undefined) ?? ctx.branchId ?? patient.branchId;
    assertBranchAccess(ctx, branchId);
    const branch = await tx.branch.findFirst({ where: { id: branchId, clinicId: ctx.clinicId, status: "ACTIVE" }, select: { id: true } });
    if (!branch) throw new DataError("INVALID_INPUT", "Choose an active branch of your clinic.");

    const invoiceNumber = await nextInvoiceNumber(tx);
    const created = await tx.invoice.create({
      data: {
        clinicId: ctx.clinicId,
        branchId,
        patientId: patient.id,
        invoiceNumber,
        issuedAt: now,
        subtotalPaise: totals.subtotalPaise,
        discountPaise: totals.discountPaise,
        taxPaise: totals.taxPaise,
        totalPaise: totals.totalPaise,
        status: deriveInvoiceStatus("PENDING", totals.totalPaise, 0),
        lineItems: {
          create: input.items.map((item, i) => ({
            description: item.description,
            category: lineCategoryFromUi(item.category),
            quantity: item.quantity,
            unitPricePaise: item.unitPricePaise,
            amountPaise: totals.lineAmountsPaise[i],
          })),
        },
      },
      select: invoiceSelect,
    });
    await logBilling(tx, "billing.invoice_created", created.id, { invoiceNumber, totalPaise: totals.totalPaise, source: "manual", lines: input.items.length });
    return invoiceDetail(ctx, tx, created as InvoiceRow);
  });
}

export const recordPaymentSchema = z.object({
  amountPaise: z.number().int(),
  method: z.enum(["cash", "upi", "card", "bank_transfer", "online"]),
  reference: z.string().trim().max(100).optional(),
});

/** Records money already received. Status is always SUCCEEDED and the time is the server's. */
export async function recordPayment(ctx: TenantContext, invoiceId: string, raw: unknown, db?: TenantTx, now = new Date()): Promise<InvoiceWithNames> {
  requirePermission(ctx, PAYMENT_CREATE);
  const input = recordPaymentSchema.parse(raw);
  if (!uuid.safeParse(invoiceId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await lockInvoice(tx, invoiceId);
    const invoice = await loadInvoice(ctx, tx, invoiceId);
    const paid = paidPaise(invoice.payments);
    rule(() => assertPayable(invoice.status, invoice.totalPaise, paid, input.amountPaise));
    const method = paymentMethodFromUi(input.method);
    await tx.payment.create({
      data: { clinicId: ctx.clinicId, invoiceId, amountPaise: input.amountPaise, method, status: "SUCCEEDED", reference: input.reference || null, paidAt: now },
    });
    const status = deriveInvoiceStatus(invoice.status, invoice.totalPaise, paid + input.amountPaise);
    if (status !== invoice.status) await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
    await logBilling(tx, "billing.payment_recorded", invoiceId, { invoiceNumber: invoice.invoiceNumber, amountPaise: input.amountPaise, method, status });
    return invoiceDetail(ctx, tx, await loadInvoice(ctx, tx, invoiceId));
  });
}

/** Marks a received payment as refunded (the refund itself is made outside the app) and re-derives the invoice status. */
export async function refundPayment(ctx: TenantContext, paymentId: string, db?: TenantTx): Promise<InvoiceWithNames> {
  requirePermission(ctx, PAYMENT_REFUND);
  if (!uuid.safeParse(paymentId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    const found = await tx.payment.findFirst({ where: { id: paymentId, clinicId: ctx.clinicId, invoice: branchWhere(ctx) }, select: { invoiceId: true } });
    if (!found) throw new AuthError("NOT_FOUND");
    await lockInvoice(tx, found.invoiceId);
    const invoice = await loadInvoice(ctx, tx, found.invoiceId);
    const payment = invoice.payments.find((p) => p.id === paymentId);
    if (!payment || payment.status !== "SUCCEEDED") throw new DataError("INVALID_TRANSITION", "Only a received payment can be refunded.");
    if (invoice.status === "VOID") throw new DataError("INVALID_TRANSITION", "Payments on a void invoice can't be changed.");
    const changed = await tx.payment.updateMany({ where: { id: paymentId, clinicId: ctx.clinicId, status: "SUCCEEDED" }, data: { status: "REFUNDED" } });
    if (changed.count !== 1) throw new DataError("INVALID_TRANSITION", "This payment was just changed by someone else. Refresh and try again.");
    const status = deriveInvoiceStatus(invoice.status, invoice.totalPaise, paidPaise(invoice.payments) - payment.amountPaise);
    if (status !== invoice.status) await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
    await logBilling(tx, "billing.payment_refunded", invoice.id, { invoiceNumber: invoice.invoiceNumber, paymentId, amountPaise: payment.amountPaise, status });
    return invoiceDetail(ctx, tx, await loadInvoice(ctx, tx, invoice.id));
  });
}

/** Cancels an invoice that has no received payments (refund them first). Void invoices are kept, never deleted. */
export async function voidInvoice(ctx: TenantContext, invoiceId: string, db?: TenantTx): Promise<InvoiceWithNames> {
  requirePermission(ctx, INVOICE_VOID);
  if (!uuid.safeParse(invoiceId).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await lockInvoice(tx, invoiceId);
    const invoice = await loadInvoice(ctx, tx, invoiceId);
    if (invoice.status === "VOID") throw new DataError("INVALID_TRANSITION", "This invoice is already void.");
    if (paidPaise(invoice.payments) > 0) throw new DataError("INVALID_TRANSITION", "Refund the received payments before voiding this invoice.");
    const changed = await tx.invoice.updateMany({ where: { id: invoiceId, clinicId: ctx.clinicId, status: invoice.status }, data: { status: "VOID" } });
    if (changed.count !== 1) throw new DataError("INVALID_TRANSITION", "This invoice was just changed by someone else. Refresh and try again.");
    await logBilling(tx, "billing.invoice_voided", invoiceId, { invoiceNumber: invoice.invoiceNumber, totalPaise: invoice.totalPaise });
    return invoiceDetail(ctx, tx, await loadInvoice(ctx, tx, invoiceId));
  });
}
