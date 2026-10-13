import { describe, expect, it } from "vitest";
import { buildDemoData, demoId } from "./demo-data";

const NOW = new Date("2026-10-12T06:30:00Z"); // 12:00 IST
const data = buildDemoData(NOW);
const DAY = 24 * 60 * 60 * 1000;

const byId = <T extends { id?: string }>(rows: T[]) => new Map(rows.map((r) => [r.id!, r]));
const clinics = byId(data.clinics);
const branches = byId(data.branches);
const patients = byId(data.patients);
const doctors = byId(data.doctorProfiles);
const appointments = byId(data.appointments);
const consultations = byId(data.consultations);
const medicines = byId(data.medicines);
const users = byId(data.users);
const roles = byId(data.roles);

describe("demo data — determinism (basis of seed idempotency)", () => {
  it("produces identical rows, including ids, for the same clock", () => {
    expect(buildDemoData(NOW)).toEqual(data);
  });

  it("keeps the same primary keys when re-run on a later day", () => {
    const later = buildDemoData(new Date(NOW.getTime() + 3 * DAY));
    for (const table of Object.keys(data) as (keyof typeof data)[]) {
      const ids = (rows: { id?: string }[]) => rows.map((r) => r.id);
      if (table === "rolePermissions" || table === "doctorBranches" || table === "patientLinks") continue; // no id column; checked below
      expect(ids(later[table] as { id?: string }[])).toEqual(ids(data[table] as { id?: string }[]));
    }
    expect(later.rolePermissions).toEqual(data.rolePermissions);
    expect(later.doctorBranches).toEqual(data.doctorBranches);
    expect(later.patientLinks).toEqual(data.patientLinks);
  });

  it("generates valid, unique UUIDs", () => {
    expect(demoId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const all = Object.values(data).flatMap((rows) => (rows as { id?: string }[]).map((r) => r.id).filter(Boolean));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("demo data — requested volumes", () => {
  it("matches the requested dataset size", () => {
    expect(data.clinics).toHaveLength(2);
    expect(data.branches).toHaveLength(3);
    expect(data.departments.length).toBeGreaterThanOrEqual(5);
    expect(data.departments.length).toBeLessThanOrEqual(8);
    expect(data.doctorProfiles).toHaveLength(8);
    expect(data.patients).toHaveLength(30);
    expect(data.appointments.length).toBeGreaterThanOrEqual(40);
    expect(data.appointments.length).toBeLessThanOrEqual(50);
    expect(data.consultations.length).toBeGreaterThanOrEqual(15);
    expect(data.consultations.length).toBeLessThanOrEqual(20);
    expect(data.prescriptions.length).toBeGreaterThanOrEqual(15);
    expect(data.prescriptions.length).toBeLessThanOrEqual(20);
    expect(data.invoices.length).toBeGreaterThanOrEqual(20);
    expect(data.invoices.length).toBeLessThanOrEqual(30);

    const staffRoleCount = (key: string) =>
      data.memberships.filter((m) => roles.get(m.roleId)!.key === key).length;
    for (const key of ["RECEPTIONIST", "NURSE"]) {
      expect(staffRoleCount(key)).toBeGreaterThanOrEqual(3);
      expect(staffRoleCount(key)).toBeLessThanOrEqual(5);
    }
    expect(staffRoleCount("ADMINISTRATOR") + staffRoleCount("CLINIC_MANAGER")).toBeGreaterThanOrEqual(3);
  });

  it("covers every requested appointment status", () => {
    const statuses = new Set(data.appointments.map((a) => a.status));
    for (const s of ["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]) expect(statuses).toContain(s);
  });

  it("spreads appointments over recent dates and the next two weeks, with some today", () => {
    const offsets = data.appointments.map((a) => ((a.startsAt as Date).getTime() - NOW.getTime()) / DAY);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-22);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(15);
    expect(offsets.some((o) => o < -1)).toBe(true);
    expect(offsets.some((o) => o > 1)).toBe(true);
    expect(offsets.filter((o) => Math.abs(o) < 0.5).length).toBeGreaterThan(0);
  });
});

describe("demo data — relationships and tenant consistency", () => {
  it("assigns every branch, department, and doctor to a valid clinic, and doctors to branches of their own clinic", () => {
    for (const b of data.branches) expect(clinics.has(b.clinicId)).toBe(true);
    for (const d of data.departments) {
      if (d.branchId) expect(branches.get(d.branchId)!.clinicId).toBe(d.clinicId);
    }
    for (const doc of data.doctorProfiles) {
      expect(users.has(doc.userId)).toBe(true);
      const assigned = data.doctorBranches.filter((db) => db.doctorId === doc.id);
      expect(assigned.length).toBeGreaterThan(0);
      expect(assigned.filter((a) => a.isPrimary)).toHaveLength(1);
      for (const a of assigned) expect(branches.get(a.branchId)!.clinicId).toBe(doc.clinicId);
    }
  });

  it("only links appointments to a patient, doctor, and branch of the same clinic, at a branch the doctor works at", () => {
    for (const a of data.appointments) {
      expect(branches.get(a.branchId)!.clinicId).toBe(a.clinicId);
      expect(patients.get(a.patientId)!.clinicId).toBe(a.clinicId);
      expect(doctors.get(a.doctorId)!.clinicId).toBe(a.clinicId);
      expect(data.doctorBranches.some((db) => db.doctorId === a.doctorId && db.branchId === a.branchId)).toBe(true);
    }
  });

  it("never double-books a doctor", () => {
    const keys = data.appointments.map((a) => `${a.doctorId}|${(a.startsAt as Date).toISOString()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("links consultations to completed appointments in the same clinic, at most one each", () => {
    const seen = new Set<string>();
    for (const c of data.consultations) {
      const appt = appointments.get(c.appointmentId)!;
      expect(appt.status).toBe("COMPLETED");
      expect(appt.clinicId).toBe(c.clinicId);
      expect(seen.has(c.appointmentId)).toBe(false);
      seen.add(c.appointmentId);
    }
  });

  it("links prescriptions to consultations in the same clinic, with items referencing real medicines", () => {
    for (const rx of data.prescriptions) {
      expect(consultations.get(rx.consultationId)!.clinicId).toBe(rx.clinicId);
      const items = data.prescriptionItems.filter((i) => i.prescriptionId === rx.id);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(medicines.has(item.medicineId)).toBe(true);
        expect(item.durationDays).toBeGreaterThan(0);
      }
    }
  });

  it("keeps human-facing numbers unique within each clinic", () => {
    const uniq = (rows: { clinicId: string }[], field: string) => {
      const keys = rows.map((r) => `${r.clinicId}|${(r as Record<string, unknown>)[field]}`);
      expect(new Set(keys).size).toBe(keys.length);
    };
    uniq(data.patients, "patientNumber");
    uniq(data.invoices, "invoiceNumber");
    uniq(data.prescriptions, "prescriptionNumber");
    uniq(data.doctorProfiles, "registrationNumber");
  });
});

describe("demo data — billing", () => {
  it("bills patients of the invoice's own clinic, and appointments only once", () => {
    const billed = data.invoices.map((i) => i.appointmentId).filter(Boolean);
    expect(new Set(billed).size).toBe(billed.length);
    for (const inv of data.invoices) {
      expect(patients.get(inv.patientId)!.clinicId).toBe(inv.clinicId);
      expect(branches.get(inv.branchId)!.clinicId).toBe(inv.clinicId);
      if (inv.appointmentId) {
        const appt = appointments.get(inv.appointmentId)!;
        expect(appt.clinicId).toBe(inv.clinicId);
        expect(appt.patientId).toBe(inv.patientId);
      }
    }
  });

  it("makes invoice totals equal their line items", () => {
    for (const inv of data.invoices) {
      const lines = data.invoiceLineItems.filter((l) => l.invoiceId === inv.id);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.amountPaise).toBe(l.quantity * l.unitPricePaise);
      expect(inv.subtotalPaise).toBe(lines.reduce((s, l) => s + l.amountPaise, 0));
      expect(inv.totalPaise).toBe(inv.subtotalPaise - (inv.discountPaise ?? 0) + (inv.taxPaise ?? 0));
      expect(inv.totalPaise).toBeGreaterThan(0);
    }
  });

  it("keeps invoice status consistent with successful payments", () => {
    const statuses = new Set<string>();
    for (const inv of data.invoices) {
      const pays = data.payments.filter((p) => p.invoiceId === inv.id);
      for (const p of pays) {
        expect(p.clinicId).toBe(inv.clinicId);
        expect(p.amountPaise).toBeGreaterThan(0);
        expect((p.paidAt as Date).getTime()).toBeGreaterThanOrEqual((inv.issuedAt as Date).getTime());
      }
      const paid = pays.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amountPaise, 0);
      statuses.add(inv.status!);
      if (inv.status === "PAID") expect(paid).toBe(inv.totalPaise);
      if (inv.status === "PARTIALLY_PAID") {
        expect(paid).toBeGreaterThan(0);
        expect(paid).toBeLessThan(inv.totalPaise);
      }
      if (inv.status === "PENDING") expect(paid).toBe(0);
    }
    expect([...statuses].sort()).toEqual(["PAID", "PARTIALLY_PAID", "PENDING"]);
  });
});

describe("demo data — safety", () => {
  it("creates no sign-in capable accounts", () => {
    for (const u of data.users) {
      expect(u.status).toBe("INVITED");
      expect(u.authProviderId ?? null).toBeNull();
      expect(Object.keys(u).some((k) => /pass/i.test(k))).toBe(false);
    }
    for (const p of data.patients) expect(p.userId ?? null).toBeNull(); // links are applied separately, fill-only
  });

  it("links the demo portal user only to a patient of a clinic where it holds a PATIENT membership", () => {
    expect(data.patientLinks).toHaveLength(1);
    for (const link of data.patientLinks) {
      const patient = patients.get(link.patientId)!;
      const membership = data.memberships.find((m) => m.userId === link.userId);
      expect(roles.get(membership!.roleId)!.key).toBe("PATIENT");
      expect(membership!.clinicId).toBe(patient.clinicId);
      expect(users.get(link.userId)!.email).toBe(patient.email);
    }
  });

  it("uses only fictional contact details", () => {
    const emails = [...data.users, ...data.patients, ...data.clinics, ...data.branches].map((r) => r.email).filter(Boolean) as string[];
    for (const e of emails) expect(e).toMatch(/@([a-z]+\.)?example\.com$/);
    const phones = [...data.users.map((u) => u.phone), ...data.patients.flatMap((p) => [p.phone, p.emergencyContactPhone])].filter(Boolean) as string[];
    for (const ph of phones) expect(ph.startsWith("+91 00000 ")).toBe(true);
  });
});
