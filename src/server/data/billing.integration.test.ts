import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, optionalContextFor, present } from "@/test/live-fixtures";
import type { TenantContext } from "@/server/auth/authorize";
import {
  createInvoiceForAppointment,
  createManualInvoice,
  getBillingSummary,
  getInvoice,
  listInvoices,
  listPayments,
  recordPayment,
  refundPayment,
  voidInvoice,
} from "./billing";

// Billing against the live database, as real (fictional) fixture users. Every
// write runs in a transaction that is rolled back, and table counts are
// compared afterwards, so no invoices, payments or audit rows are left behind.

let admin: Client;
let adminA: TenantContext; // Aarogya administrator (billing.manage), clinic-wide
let adminB: TenantContext; // Nirmaya administrator
let managerWakad: TenantContext; // Aarogya clinic manager, Wakad only (billing.view)
let receptionWakad: TenantContext; // Aarogya receptionist, Wakad only (billing.view + payment.create)
let nurseKothrud: TenantContext | undefined; // no billing permissions
let doctor1: TenantContext; // no billing permissions
let counts: Record<string, number>;

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  invoices: await n(`SELECT count(*) n FROM invoices`),
  lines: await n(`SELECT count(*) n FROM invoice_line_items`),
  payments: await n(`SELECT count(*) n FROM payments`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);

/** A seed invoice of clinic A matching `where` (admin ground truth). */
async function seedInvoice(where: string, params: unknown[] = []): Promise<{ id: string; totalPaise: number; branchId: string }> {
  const row = (
    await admin.query(
      `SELECT i.id, i."totalPaise", i."branchId" FROM invoices i WHERE i."clinicId" = $1 AND ${where} ORDER BY i."invoiceNumber" LIMIT 1`,
      [FIX.clinicA, ...params]
    )
  ).rows[0];
  if (!row) throw new Error(`No seed invoice matches: ${where}`);
  return { id: row.id, totalPaise: Number(row.totalPaise), branchId: row.branchId };
}
const unpaid = `i.status = 'PENDING' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'SUCCEEDED') AND i."totalPaise" > 0`;

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  const ctxs: TenantContext[] = [];
  for (const k of ["ST-01", "ST-07", "ST-02", "ST-04", "DR-01"]) ctxs.push(await contextFor(admin, k)); // one pg client: sequential
  [adminA, adminB, managerWakad, receptionWakad, doctor1] = ctxs;
  nurseKothrud = await optionalContextFor(admin, "ST-05");
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts()).toEqual(counts);
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("reading invoices and payments", () => {
  it("lists exactly the clinic's invoices, with paid amounts from SUCCEEDED payments only", async () => {
    const page = await listInvoices(adminA, { pageSize: 100 });
    expect(page.total).toBe(await n(`SELECT count(*) n FROM invoices WHERE "clinicId" = $1`, [FIX.clinicA]));
    expect(page.items.every((i) => /^AAR-INV-\d{4}$/.test(i.invoiceNumber ?? ""))).toBe(true);
    for (const inv of page.items.slice(0, 10)) {
      const paid = await n(`SELECT coalesce(sum("amountPaise"), 0) n FROM payments WHERE "invoiceId" = $1 AND status = 'SUCCEEDED'`, [inv.id]);
      expect(Math.round(inv.paid * 100)).toBe(paid);
    }
  });

  it("restricts branch staff to their branch, and refuses another branch on request", async () => {
    const wakad = await listInvoices(receptionWakad, { pageSize: 100 });
    expect(wakad.total).toBe(await n(`SELECT count(*) n FROM invoices WHERE "clinicId" = $1 AND "branchId" = $2`, [FIX.clinicA, FIX.wakad]));
    expect(wakad.items.every((i) => i.branchId === FIX.wakad)).toBe(true);
    expect(await code(listInvoices(receptionWakad, { branchId: FIX.kothrud }))).toBe("BRANCH_FORBIDDEN");
    const kothrudInvoice = await seedInvoice(`i."branchId" = $2`, [FIX.kothrud]);
    expect(await code(getInvoice(receptionWakad, kothrudInvoice.id))).toBe("NOT_FOUND");
  });

  it("never crosses clinics", async () => {
    const inv = await seedInvoice("true");
    expect(await code(getInvoice(adminB, inv.id))).toBe("NOT_FOUND");
    expect((await listInvoices(adminB, { search: "AAR-INV" })).total).toBe(0);
    expect(await code(getInvoice(adminA, "not-a-uuid"))).toBe("NOT_FOUND");
  });

  it("denies roles without billing permissions — in the app and, independently, in RLS", async () => {
    for (const ctx of present(doctor1, nurseKothrud)) {
      expect(await code(listInvoices(ctx, {}))).toBe("FORBIDDEN");
      expect(await code(listPayments(ctx, {}))).toBe("FORBIDDEN");
      expect(await code(getBillingSummary(ctx))).toBe("FORBIDDEN");
    }
    await inRollback(async ({ tx, as }) => {
      await as(doctor1);
      expect(await tx.invoice.count()).toBe(0);
      expect(await tx.payment.count()).toBe(0);
    });
  });

  it("returns an invoice's line items, payments and branch details", async () => {
    const inv = await seedInvoice(`EXISTS (SELECT 1 FROM payments p WHERE p."invoiceId" = i.id)`);
    const detail = await getInvoice(adminA, inv.id);
    expect(detail.items.length).toBe(await n(`SELECT count(*) n FROM invoice_line_items WHERE "invoiceId" = $1`, [inv.id]));
    expect(detail.payments?.length).toBe(await n(`SELECT count(*) n FROM payments WHERE "invoiceId" = $1`, [inv.id]));
    expect(detail.branchName).toBeTruthy();
    expect(Math.round(detail.total * 100)).toBe(inv.totalPaise);
  });

  it("lists payments for the clinic and branch", async () => {
    expect((await listPayments(adminA, { pageSize: 100 })).total).toBe(await n(`SELECT count(*) n FROM payments WHERE "clinicId" = $1`, [FIX.clinicA]));
    expect((await listPayments(receptionWakad, { pageSize: 100 })).total).toBe(
      await n(`SELECT count(*) n FROM payments p JOIN invoices i ON i.id = p."invoiceId" WHERE p."clinicId" = $1 AND i."branchId" = $2`, [FIX.clinicA, FIX.wakad])
    );
  });

  it("computes outstanding balances that match the database", async () => {
    const outstandingSql = `SELECT coalesce(sum(i."totalPaise" - coalesce((SELECT sum(p."amountPaise") FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'SUCCEEDED'), 0)), 0) n
      FROM invoices i WHERE i."clinicId" = $1 AND i.status IN ('PENDING', 'PARTIALLY_PAID')`;
    const summary = await getBillingSummary(adminA);
    expect(Math.round(summary.outstandingBalance * 100)).toBe(await n(outstandingSql, [FIX.clinicA]));
    // Recorded expenses this IST month (the administrator holds billing.manage); null without expense permissions.
    expect(typeof summary.totalExpensesThisMonth).toBe("number");
    expect(summary.canCreateInvoice).toBe(true);
    const branch = await getBillingSummary(managerWakad);
    expect(branch.totalExpensesThisMonth).toBeNull();
    expect(Math.round(branch.outstandingBalance * 100)).toBe(await n(`${outstandingSql} AND i."branchId" = $2`, [FIX.clinicA, FIX.wakad]));
    expect(branch.canCreateInvoice).toBe(false);
  });
});

describe("creating invoices", () => {
  it("creates a manual invoice with server-computed totals, the next clinic number and an audit event", async () => {
    const patientId = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 1`, [FIX.clinicA])).rows[0].id;
    const maxBefore = await n(`SELECT max(substr("invoiceNumber", 9)::int) n FROM invoices WHERE "clinicId" = $1`, [FIX.clinicA]);
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const inv = await createManualInvoice(
        adminA,
        {
          patientId,
          branchId: FIX.kothrud,
          items: [
            { description: "Test lab panel", category: "lab_test", quantity: 2, unitPricePaise: 25_000 },
            { description: "Test dressing", category: "procedure", quantity: 1, unitPricePaise: 50_000 },
          ],
          discountPaise: 10_000,
          taxRatePercent: 18,
          // Client-supplied totals/status are not part of the schema and are ignored.
          totalPaise: 1,
          status: "PAID",
        },
        tx
      );
      expect(inv).toMatchObject({ subtotal: 1000, discount: 100, tax: 162, total: 1062, paid: 0, balance: 1062, status: "pending", branchId: FIX.kothrud });
      expect(inv.invoiceNumber).toBe(`AAR-INV-${String(maxBefore + 1).padStart(4, "0")}`);
      expect(inv.items.map((i) => i.amount)).toEqual([500, 500]);
      // Persisted, and numbering is serialised: the next invoice gets the next number.
      expect((await getInvoice(adminA, inv.id, tx)).total).toBe(1062);
      const second = await createManualInvoice(adminA, { patientId, items: [{ description: "Test", category: "other", quantity: 1, unitPricePaise: 100 }] }, tx);
      expect(second.invoiceNumber).toBe(`AAR-INV-${String(maxBefore + 2).padStart(4, "0")}`);
      const audit = await tx.auditEvent.findMany({ where: { action: "billing.invoice_created", targetId: { in: [inv.id, second.id] } }, select: { actorUserId: true, metadata: true } });
      expect(audit).toHaveLength(2);
      expect(audit[0].actorUserId).toBe(adminA.userId);
      expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Test lab panel|patient/i); // no line descriptions or patient details
    });
  });

  it("rejects invalid amounts, other clinics' patients, and users without invoice.create", async () => {
    const patientA = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 LIMIT 1`, [FIX.clinicA])).rows[0].id;
    const patientB = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 LIMIT 1`, [FIX.clinicB])).rows[0].id;
    const line = { description: "Test", category: "other", quantity: 1, unitPricePaise: 10_000 };
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await code(createManualInvoice(adminA, { patientId: patientA, items: [line], discountPaise: 10_001 }, tx))).toBe("INVALID_INPUT");
      expect(await code(createManualInvoice(adminA, { patientId: patientA, items: [{ ...line, quantity: 0 }] }, tx))).toBe("INVALID_INPUT");
      expect(await code(createManualInvoice(adminA, { patientId: patientA, items: [{ ...line, unitPricePaise: 10.5 }] }, tx))).toBe("ZodError");
      expect(await code(createManualInvoice(adminA, { patientId: patientA, items: [] }, tx))).toBe("ZodError");
      expect(await code(createManualInvoice(adminA, { patientId: patientA, items: [line], taxRatePercent: 40 }, tx))).toBe("INVALID_INPUT");
      expect(await code(createManualInvoice(adminA, { patientId: patientB, items: [line] }, tx))).toBe("INVALID_INPUT");
      await as(receptionWakad);
      expect(await code(createManualInvoice(receptionWakad, { patientId: patientA, items: [line] }, tx))).toBe("FORBIDDEN");
      // Even called directly, the numbering function refuses a user who can't create invoices.
      expect(await code(tx.$queryRaw`SELECT app.next_document_number('invoice')`)).not.toBe("OK");
    });
  });

  it("invoices an appointment at the doctor's fee, once", async () => {
    const appt = (
      await admin.query(
        `SELECT a.id, d."consultationFeePaise" fee FROM appointments a JOIN doctor_profiles d ON d.id = a."doctorId"
         WHERE a."clinicId" = $1 AND a.status IN ('SCHEDULED', 'CONFIRMED', 'COMPLETED') AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i."appointmentId" = a.id)
         ORDER BY a."startsAt" LIMIT 1`,
        [FIX.clinicA]
      )
    ).rows[0];
    const cancelled = (await admin.query(`SELECT id FROM appointments WHERE "clinicId" = $1 AND status = 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i."appointmentId" = appointments.id) LIMIT 1`, [FIX.clinicA])).rows[0];
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const inv = await createInvoiceForAppointment(adminA, appt.id, tx);
      expect(inv.appointmentId).toBe(appt.id);
      expect(Math.round(inv.total * 100)).toBe(Number(appt.fee));
      expect(inv.items).toHaveLength(1);
      expect(inv.items[0].category).toBe("consultation");
      expect((await createInvoiceForAppointment(adminA, appt.id, tx)).id).toBe(inv.id); // idempotent
      if (cancelled) expect(await code(createInvoiceForAppointment(adminA, cancelled.id, tx))).toBe("INVALID_TRANSITION");
      await as(adminB);
      expect(await code(createInvoiceForAppointment(adminB, appt.id, tx))).toBe("NOT_FOUND");
    });
  });
});

describe("payments, refunds and voiding", () => {
  it("records partial and full payments, re-deriving the status, and never over-collects", async () => {
    const inv = await seedInvoice(`${unpaid} AND i."branchId" = $2`, [FIX.wakad]);
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad); // receptionists can take payments at their branch
      const half = Math.floor(inv.totalPaise / 2);
      const partial = await recordPayment(receptionWakad, inv.id, { amountPaise: half, method: "upi", reference: "TEST-REF-1", status: "FAILED" }, tx);
      expect(partial.status).toBe("partial");
      expect(Math.round(partial.paid * 100)).toBe(half);
      expect(partial.payments?.at(-1)).toMatchObject({ status: "success", method: "upi", reference: "TEST-REF-1" }); // client status ignored
      expect(await code(recordPayment(receptionWakad, inv.id, { amountPaise: inv.totalPaise - half + 1, method: "cash" }, tx))).toBe("INVALID_INPUT");
      const full = await recordPayment(receptionWakad, inv.id, { amountPaise: inv.totalPaise - half, method: "cash" }, tx);
      expect(full).toMatchObject({ status: "paid", balance: 0 });
      expect(await code(recordPayment(receptionWakad, inv.id, { amountPaise: 1, method: "cash" }, tx))).toBe("INVALID_INPUT");
      // Persisted in the database row, not just the response.
      expect((await tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, select: { status: true } })).status).toBe("PAID");
      expect(await code(recordPayment(receptionWakad, inv.id, { amountPaise: 0, method: "cash" }, tx))).toBe("INVALID_INPUT");
      expect(await code(recordPayment(receptionWakad, inv.id, { amountPaise: 100, method: "bitcoin" }, tx))).toBe("ZodError");
    });
  });

  it("keeps payments inside the user's branch and clinic", async () => {
    const kothrud = await seedInvoice(`${unpaid} AND i."branchId" = $2`, [FIX.kothrud]);
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad);
      expect(await code(recordPayment(receptionWakad, kothrud.id, { amountPaise: 100, method: "cash" }, tx))).toBe("NOT_FOUND");
      await as(adminB);
      expect(await code(recordPayment(adminB, kothrud.id, { amountPaise: 100, method: "cash" }, tx))).toBe("NOT_FOUND");
      await as(managerWakad); // view-only
      expect(await code(recordPayment(managerWakad, kothrud.id, { amountPaise: 100, method: "cash" }, tx))).toBe("FORBIDDEN");
    });
  });

  it("serialises concurrent payments on one invoice", async () => {
    const inv = await seedInvoice(unpaid);
    let firstDone = 0;
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const firstHasLock = new Promise<void>((r) => (started = r));
    const first = inRollback(async ({ tx, as }) => {
      await as(adminA);
      await recordPayment(adminA, inv.id, { amountPaise: inv.totalPaise, method: "cash" }, tx);
      started();
      await holding; // keep the invoice lock while the second request arrives
      firstDone = Date.now();
    });
    await firstHasLock;
    const second = inRollback(async ({ tx, as }) => {
      await as(adminA);
      // Blocks on the invoice lock until the first transaction ends (rolled back), then sees the full balance.
      const paid = await recordPayment(adminA, inv.id, { amountPaise: inv.totalPaise, method: "card" }, tx);
      expect(firstDone).toBeGreaterThan(0);
      expect(paid.status).toBe("paid");
    });
    setTimeout(release, 1500);
    await Promise.all([first, second]);
  });

  it("marks a payment refunded (refund.manage/billing.manage only) and reopens the balance", async () => {
    const paidInv = await seedInvoice(`i.status = 'PAID' AND i."totalPaise" > 0`);
    const payment = (await admin.query(`SELECT id, "amountPaise" FROM payments WHERE "invoiceId" = $1 AND status = 'SUCCEEDED' ORDER BY "paidAt" LIMIT 1`, [paidInv.id])).rows[0];
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad);
      expect(await code(refundPayment(receptionWakad, payment.id, tx))).toBe("FORBIDDEN");
      await as(adminA);
      const after = await refundPayment(adminA, payment.id, tx);
      expect(Math.round(after.balance * 100)).toBe(Number(payment.amountPaise));
      expect(["partial", "pending"]).toContain(after.status);
      expect(after.payments?.find((p) => p.id === payment.id)?.status).toBe("refunded");
      expect(await code(refundPayment(adminA, payment.id, tx))).toBe("INVALID_TRANSITION");
      expect(await tx.auditEvent.count({ where: { action: "billing.payment_refunded", targetId: paidInv.id } })).toBe(1);
    });
  });

  it("voids only invoices without received payments, and a void invoice takes no payments", async () => {
    const open = await seedInvoice(unpaid);
    const paidInv = await seedInvoice(`i.status = 'PAID' AND i."totalPaise" > 0`);
    await inRollback(async ({ tx, as }) => {
      await as(receptionWakad);
      expect(await code(voidInvoice(receptionWakad, open.id, tx))).toBe("FORBIDDEN");
      await as(adminA);
      expect(await code(voidInvoice(adminA, paidInv.id, tx))).toBe("INVALID_TRANSITION");
      const voided = await voidInvoice(adminA, open.id, tx);
      expect(voided).toMatchObject({ status: "void", balance: 0 });
      expect(voided.capabilities).toEqual({ recordPayment: false, void: false, refund: false });
      expect(await code(voidInvoice(adminA, open.id, tx))).toBe("INVALID_TRANSITION");
      expect(await code(recordPayment(adminA, open.id, { amountPaise: 100, method: "cash" }, tx))).toBe("INVALID_INPUT");
    });
  });
});
