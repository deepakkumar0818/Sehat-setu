import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, optionalContextFor, present } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import { verifiedPgConfig } from "@/server/db/tls";
import type { TenantContext } from "@/server/auth/authorize";
import { DOSAGE_FORM_VALUES } from "@/lib/dosage-forms";
import { createCatalogMedicine, searchCatalog } from "./medicines";
import { medicineStrengthKey, medicineTextKey } from "./medicine-rules";

// Shared medicine catalogue against the live database, as real (fictional)
// fixture users. Every medicine created here lives only inside a transaction
// that is rolled back; medicine and audit counts are compared afterwards, so
// nothing is added to the live catalogue. Test names start with "ZZTEST".

let admin: Client;
let adminA: TenantContext; // Aarogya administrator (medicine.catalog.create)
let adminB: TenantContext; // Nirmaya administrator
let managerWakad: TenantContext;
let receptionWakad: TenantContext;
let nurseKothrud: TenantContext | undefined;
let doctor1: TenantContext;
let counts: Record<string, number>;

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  medicines: await n(`SELECT count(*) n FROM medicines`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  permissions: await n(`SELECT count(*) n FROM permissions`),
  rolePermissions: await n(`SELECT count(*) n FROM role_permissions`),
});
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; details?: unknown; message: string }) => e);
const med = (over: Record<string, unknown> = {}) => ({ name: "ZZTEST Brandol", genericName: "Zztestamide", strength: "250 mg", dosageForm: "tablet", ...over });

/** The runtime role (sehat_app) as a raw client, for direct database attempts inside a rolled-back transaction. */
async function asRuntime(fn: (q: (sql: string, p?: unknown[]) => Promise<{ ok: boolean; msg: string; rows: Record<string, unknown>[] }>, pin: (userKey: string, clinicKey: string, branchKey?: string) => Promise<void>) => Promise<void>) {
  const app = new Client(verifiedPgConfig(process.env.DATABASE_URL!));
  await app.connect();
  try {
    await app.query("BEGIN");
    const q = async (sql: string, p: unknown[] = []) => {
      await app.query("SAVEPOINT s");
      try {
        const r = await app.query(sql, p);
        await app.query("RELEASE SAVEPOINT s");
        return { ok: true, msg: "", rows: r.rows };
      } catch (e) {
        await app.query("ROLLBACK TO SAVEPOINT s");
        return { ok: false, msg: (e as Error).message, rows: [] };
      }
    };
    const pin = async (userKey: string, clinicKey: string, branchKey?: string) => {
      await app.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true)`, [
        demoId(`user:${userKey}`), demoId(`clinic:${clinicKey}`), branchKey ? demoId(`branch:${branchKey}`) : "",
      ]);
    };
    await fn(q, pin);
  } finally {
    await app.query("ROLLBACK");
    await app.end();
  }
}

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
  expect(await tableCounts()).toEqual(counts); // nothing left in the catalogue or the audit trail
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

describe("end-to-end creation workflow (rolled back, verified by id afterwards)", () => {
  it("creates, audits, blocks the duplicate, confirms a second brand — and leaves nothing behind", async () => {
    const createdIds: string[] = [];
    const before = await tableCounts();

    await inRollback(async ({ tx, as }) => {
      await as(adminA);

      // 1. An authorized Administrator creates a medicine.
      const created = await createCatalogMedicine(adminA, { name: "ZZTEST Workflowin", genericName: "Zzworkflowamide", strength: "125 mg", dosageForm: "suspension" }, tx);
      createdIds.push(created.id);
      expect(created).toMatchObject({ name: "ZZTEST Workflowin", genericName: "Zzworkflowamide", strength: "125 mg", dosageForm: "suspension" });
      const row = await tx.medicine.findUniqueOrThrow({ where: { id: created.id }, select: { isActive: true, dosageForm: true } });
      expect(row).toEqual({ isActive: true, dosageForm: "SUSPENSION" });

      // 2. Its two audit events exist inside the transaction, with actor, originating clinic and identifying fields.
      const events = await tx.auditEvent.findMany({ where: { targetId: created.id }, orderBy: { action: "asc" }, select: { action: true, actorUserId: true, clinicId: true, targetType: true, outcome: true, metadata: true } });
      expect(events.map((e) => e.action)).toEqual(["catalog.medicine_created", "medicines.insert"]);
      for (const e of events) expect(e).toMatchObject({ actorUserId: adminA.userId, clinicId: FIX.clinicA, targetType: "medicines", outcome: "SUCCESS" });
      expect(events[0].metadata).toEqual({ name: "ZZTEST Workflowin", genericName: "Zzworkflowamide", strength: "125 mg", dosageForm: "SUSPENSION" });

      // 3. The same normalised name + strength + form is rejected as a duplicate (pointing at the entry above).
      const dup = await errorOf(createCatalogMedicine(adminA, { name: "  zztest   WORKFLOWIN ", genericName: "Anything", strength: "125MG", dosageForm: "suspension" }, tx));
      expect(dup?.code).toBe("DUPLICATE");
      expect((dup?.details as { existing: { id: string } }).existing.id).toBe(created.id);

      // 4. A different brand with the same generic, strength and form → confirmation warning; confirmed → created.
      const brandB = { name: "ZZTEST Otherbrand", genericName: "zzworkflowamide", strength: "125 mg", dosageForm: "suspension" };
      const warn = await errorOf(createCatalogMedicine(adminA, brandB, tx));
      expect(warn?.code).toBe("NEEDS_CONFIRMATION");
      expect((warn?.details as { matches: { id: string }[] }).matches.map((m) => m.id)).toEqual([created.id]);
      const confirmed = await createCatalogMedicine(adminA, { ...brandB, confirmGenericMatch: true }, tx);
      createdIds.push(confirmed.id);
      expect(confirmed).toMatchObject({ name: "ZZTEST Otherbrand", strength: "125 mg", dosageForm: "suspension" });
      expect(await tx.auditEvent.count({ where: { targetId: confirmed.id } })).toBe(2);

      // 5. The non-administrator roles are refused in the app (database-function refusals are covered below, via asRuntime).
      for (const ctx of present(managerWakad, doctor1, receptionWakad, nurseKothrud)) {
        await as(ctx);
        expect(await code(createCatalogMedicine(ctx, { name: "ZZTEST Refused", genericName: "Zzrefused", strength: "1 mg", dosageForm: "tablet" }, tx))).toBe("FORBIDDEN");
      }
    });

    // 6. After the rollback: nothing survives — checked by id, not just by counts.
    expect(createdIds).toHaveLength(2);
    expect(await n(`SELECT count(*) n FROM medicines WHERE id = ANY($1::uuid[])`, [createdIds])).toBe(0);
    expect(await n(`SELECT count(*) n FROM audit_events WHERE "targetId" = ANY($1::text[])`, [createdIds])).toBe(0);
    expect(await n(`SELECT count(*) n FROM medicines WHERE name ILIKE 'zztest%'`)).toBe(0);
    expect(await tableCounts()).toEqual(before);
  });
});

describe("authorization", () => {
  it("lets only administrators create, in the app", async () => {
    for (const ctx of present(managerWakad, receptionWakad, nurseKothrud, doctor1)) {
      expect(await code(createCatalogMedicine(ctx, med()))).toBe("FORBIDDEN");
    }
    expect((await searchCatalog(adminA, {})).canCreate).toBe(true);
    expect((await searchCatalog(managerWakad, {})).canCreate).toBe(false); // can view (inventory), not add
    expect((await searchCatalog(doctor1, {})).canCreate).toBe(false); // can view (prescribing), not add
    for (const ctx of present(receptionWakad, nurseKothrud)) expect(await code(searchCatalog(ctx, {}))).toBe("FORBIDDEN");
  });

  it("refuses non-administrators inside the database function too, and the runtime role can't write medicines directly", async () => {
    await asRuntime(async (q, pin) => {
      for (const [user, branch] of [["ST-02", "AAR-WKD"], ["ST-04", "AAR-WKD"], ["ST-05", "AAR-KTH"], ["DR-01", undefined], ["PU-01", undefined]] as const) {
        await pin(user, "AAR", branch);
        const r = await q(`SELECT app.create_catalog_medicine('ZZTEST Direct', 'Zztestamide', '1 mg', 'TABLET')`);
        expect(r.ok, user).toBe(false);
        expect(r.msg, user).toMatch(/catalog medicine: not permitted/);
      }
      await pin("ST-01", "AAR");
      for (const sql of [
        `INSERT INTO medicines (id, name, "genericName", strength, "dosageForm", "updatedAt") VALUES (gen_random_uuid(), 'ZZTEST Raw', 'Raw', '1 mg', 'TABLET', now())`,
        `UPDATE medicines SET name = name`,
        `DELETE FROM medicines WHERE false`,
      ]) {
        expect((await q(sql)).msg, sql).toMatch(/permission denied for table medicines/);
      }
      // Without any verified context the function refuses as well.
      await pin("", "AAR");
      expect((await q(`SELECT app.create_catalog_medicine('ZZTEST Direct', 'Zztestamide', '1 mg', 'TABLET')`)).msg).toMatch(/not permitted/);
    });
  });
});

describe("creating and duplicates", () => {
  it("creates a medicine for an administrator and blocks normalised duplicates", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const created = await createCatalogMedicine(adminA, med({ name: "  ZZTEST   Brandol ", strength: "250 MG" }), tx);
      expect(created).toMatchObject({ name: "ZZTEST Brandol", genericName: "Zztestamide", strength: "250 MG", dosageForm: "tablet" });
      for (const variant of [
        med(),                                         // exact
        med({ name: "zztest brandol" }),               // case
        med({ name: "   ZZTEST Brandol   " }),         // outer spaces
        med({ name: "ZZTEST    Brandol" }),            // repeated spaces
        med({ strength: "250mg" }),                    // spacing in strength
        med({ strength: " 250  Mg ", genericName: "Something else" }), // generic name doesn't matter for a hard duplicate
      ]) {
        const err = await errorOf(createCatalogMedicine(adminA, variant, tx));
        expect(err?.code, JSON.stringify(variant)).toBe("DUPLICATE");
        expect((err?.details as { existing?: { id: string } })?.existing?.id).toBe(created.id);
      }
      // Same name and strength in another form is a different product.
      expect((await createCatalogMedicine(adminA, med({ dosageForm: "capsule" }), tx)).dosageForm).toBe("capsule");
      // Persisted and searchable.
      expect((await searchCatalog(adminA, { search: "zztest brandol" }, tx)).total).toBe(2);
    });
  });

  it("matches the database's normalisation exactly", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const samples = ["  Dolo   650 ", "DOLO\t650", "500 mg / 250 IU", " 1 % w/w ", "Amoxicillin-Clavulanate"];
      for (const s of samples) {
        const [row] = await tx.$queryRaw<{ t: string; st: string }[]>`SELECT app.medicine_text_key(${s}) AS t, app.medicine_strength_key(${s}) AS st`;
        expect(row, s).toEqual({ t: medicineTextKey(s), st: medicineStrengthKey(s) });
      }
    });
  });

  it("enforces uniqueness in the database itself, not only through the pre-check", async () => {
    // As the migration role, inside a rolled-back transaction: insert directly, bypassing the function.
    await admin.query("BEGIN");
    try {
      await admin.query(`INSERT INTO medicines (id, name, "genericName", strength, "dosageForm", "updatedAt") VALUES (gen_random_uuid(), 'ZZTEST Uniq', 'Zz', '5 mg', 'TABLET', now())`);
      await expect(
        admin.query(`INSERT INTO medicines (id, name, "genericName", strength, "dosageForm", "updatedAt") VALUES (gen_random_uuid(), ' zztest   UNIQ ', 'Zz', '5mg', 'TABLET', now())`)
      ).rejects.toThrow(/medicines_normalized_key/);
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  it("serialises concurrent creation of the same medicine on the unique index", async () => {
    let release!: () => void;
    const holding = new Promise<void>((r) => (release = r));
    let firstIn!: () => void;
    const firstCreated = new Promise<void>((r) => (firstIn = r));
    let firstEnded = 0;
    const first = inRollback(async ({ tx, as }) => {
      await as(adminA);
      await createCatalogMedicine(adminA, med({ name: "ZZTEST Race" }), tx);
      firstIn();
      await holding; // keep the uncommitted row (and its index entry) while the second request arrives
      firstEnded = Date.now();
    });
    await firstCreated;
    const second = inRollback(async ({ tx, as }) => {
      await as(adminA);
      // Waits on the first transaction's index entry; once that rolls back, this one may insert.
      const created = await createCatalogMedicine(adminA, med({ name: "zztest  race" }), tx);
      expect(firstEnded).toBeGreaterThan(0);
      expect(created.name).toBe("zztest race");
    });
    setTimeout(release, 1500);
    await Promise.all([first, second]);
  });
});

describe("same generic, different brand", () => {
  it("warns with the matching entries and proceeds only after confirmation", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const brandA = await createCatalogMedicine(adminA, med({ name: "ZZTEST Brand A", genericName: "Zzgenerin", strength: "10 mg" }), tx);
      const warn = await errorOf(createCatalogMedicine(adminA, med({ name: "ZZTEST Brand B", genericName: "  zzgenerin ", strength: "10mg" }), tx));
      expect(warn?.code).toBe("NEEDS_CONFIRMATION");
      expect((warn?.details as { matches: { id: string }[] }).matches.map((m) => m.id)).toEqual([brandA.id]);
      const brandB = await createCatalogMedicine(adminA, med({ name: "ZZTEST Brand B", genericName: "Zzgenerin", strength: "10 mg", confirmGenericMatch: true }), tx);
      expect(brandB.name).toBe("ZZTEST Brand B");
      // A generic-name match alone is not a warning: different strength or different form.
      expect((await createCatalogMedicine(adminA, med({ name: "ZZTEST Brand C", genericName: "Zzgenerin", strength: "20 mg" }), tx)).strength).toBe("20 mg");
      expect((await createCatalogMedicine(adminA, med({ name: "ZZTEST Brand D", genericName: "Zzgenerin", strength: "10 mg", dosageForm: "syrup" }), tx)).dosageForm).toBe("syrup");
    });
  });
});

describe("dosage forms", () => {
  it("accepts all 13 forms and rejects others", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      for (const form of DOSAGE_FORM_VALUES) {
        expect((await createCatalogMedicine(adminA, med({ name: `ZZTEST Form ${form}`, dosageForm: form }), tx)).dosageForm).toBe(form);
      }
      expect(await code(createCatalogMedicine(adminA, med({ name: "ZZTEST Spray", dosageForm: "spray" }), tx))).toBe("ZodError");
    });
  });
});

describe("search", () => {
  it("pages through more than 50 matches, bounded to 25 per page", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      for (let i = 1; i <= 60; i++) {
        await createCatalogMedicine(adminA, med({ name: `ZZTEST Search ${String(i).padStart(3, "0")}`, genericName: `Zzsearchine ${i}` }), tx);
      }
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await searchCatalog(adminA, { search: "zztest search", page, pageSize: 25 }, tx);
        expect(res.total).toBe(60);
        seen.push(...res.items.map((m) => m.name));
      }
      expect(seen).toHaveLength(60);
      expect(new Set(seen).size).toBe(60);
      expect(seen[0]).toBe("ZZTEST Search 001");
      expect(seen[59]).toBe("ZZTEST Search 060");
      expect((await searchCatalog(adminA, { search: "zztest search", pageSize: 1000 }, tx)).items).toHaveLength(25); // clamped
      expect((await searchCatalog(adminA, { search: "zzsearchine 42" }, tx)).items.map((m) => m.name)).toEqual(["ZZTEST Search 042"]); // generic-name search
      expect((await searchCatalog(adminA, { search: "zzzz-nothing" }, tx)).total).toBe(0);
    });
  });
});

describe("audit and cross-clinic access", () => {
  it("records actor, originating clinic and identifying fields; only the creating clinic can read them", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const created = await createCatalogMedicine(adminA, med({ name: "ZZTEST Audited", dosageForm: "gel", strength: "1% w/w" }), tx);
      const events = await tx.auditEvent.findMany({ where: { targetId: created.id }, select: { action: true, actorUserId: true, clinicId: true, metadata: true } });
      const row = events.find((e) => e.action === "medicines.insert");
      const cat = events.find((e) => e.action === "catalog.medicine_created");
      expect(row).toMatchObject({ actorUserId: adminA.userId, clinicId: FIX.clinicA });
      expect(cat).toMatchObject({ actorUserId: adminA.userId, clinicId: FIX.clinicA, metadata: { name: "ZZTEST Audited", genericName: "Zztestamide", strength: "1% w/w", dosageForm: "GEL" } });
      expect(await code(tx.$executeRaw`UPDATE audit_events SET metadata = '{}' WHERE "targetId" = ${created.id}`)).not.toBe("OK"); // immutable
    });
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      const created = await createCatalogMedicine(adminA, med({ name: "ZZTEST Shared" }), tx);
      await as(adminB);
      expect(await tx.auditEvent.count({ where: { targetId: created.id } })).toBe(0); // other clinic: no audit visibility
      expect((await searchCatalog(adminB, { search: "zztest shared" }, tx)).items.map((m) => m.id)).toEqual([created.id]); // but the shared medicine is visible
    });
  });
});
