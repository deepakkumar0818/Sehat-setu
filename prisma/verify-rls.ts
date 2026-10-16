// Verifies, against the real database, that Row-Level Security, the runtime
// role, TLS and the audit trail actually behave as designed. Read-only: every
// write attempt runs inside a transaction that is rolled back.
//
//   npm run db:verify-rls
//
// Needs the migrations applied, the demo seed loaded (its fictional users and
// clinics are the fixtures), and DATABASE_URL pointing at sehat_app.
import { config } from "dotenv";
import type { TLSSocket } from "node:tls";
import { Client } from "pg";
import { demoId } from "./seed/demo-data";
import { verifiedPgConfig } from "../src/server/db/tls";

config({ path: [".env.local", ".env"], quiet: true });

const CLINIC_A = demoId("clinic:AAR");
const CLINIC_B = demoId("clinic:NIR");
const BRANCH_A_WAKAD = demoId("branch:AAR-WKD");
const BRANCH_A_KOTHRUD = demoId("branch:AAR-KTH");
const ADMIN_A = demoId("user:ST-01"); // Aarogya administrator, clinic-wide
const RECEPTION_WAKAD = demoId("user:ST-04"); // Aarogya receptionist, Wakad branch only
const ADMIN_B = demoId("user:ST-07"); // Nirmaya administrator
const DOCTOR_1_USER = demoId("user:DR-01");
const DOCTOR_1 = demoId("doctor:DR-01");
const DOCTOR_2 = demoId("doctor:DR-02");
const PORTAL_USER = demoId("user:PU-01"); // patient-portal user linked to Aarogya patient #1
const PORTAL_PATIENT = demoId("patient:1");

type Check = { check: string; ok: boolean; detail: string };
const results: Check[] = [];
const record = (check: string, ok: boolean, detail = "") => results.push({ check, ok, detail });

type Ctx = { user_id?: string; clinic_id?: string; branch_id?: string; auth_user_id?: string };

async function inTx<T>(client: Client, ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    for (const [key, value] of Object.entries(ctx)) {
      await client.query("SELECT set_config($1, $2, true)", [`app.${key}`, value]);
    }
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function attempt(client: Client, sql: string, params: unknown[] = []): Promise<{ ok: boolean; rowCount: number; message: string }> {
  await client.query("SAVEPOINT attempt");
  try {
    const r = await client.query(sql, params);
    return { ok: true, rowCount: r.rowCount ?? 0, message: "" };
  } catch (err) {
    return { ok: false, rowCount: 0, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
  }
}

const count = async (client: Client, sql: string, params: unknown[] = []) => Number((await client.query(sql, params)).rows[0].n);
const short = (s: string) => s.slice(0, 70);

async function main() {
  const runtimeUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DIRECT_URL;
  if (!runtimeUrl || !adminUrl) throw new Error("DATABASE_URL and DIRECT_URL must be set in .env.local.");

  const app = new Client(verifiedPgConfig(runtimeUrl));
  const admin = new Client(verifiedPgConfig(adminUrl));
  await app.connect();
  await admin.connect();
  try {
    // --- Transport and role -------------------------------------------------------------------
    const socket = (app as unknown as { connection: { stream: TLSSocket } }).connection.stream;
    record("runtime connection uses verified TLS", socket.encrypted === true && socket.authorized === true, `${socket.getProtocol?.()} authorized=${socket.authorized}`);
    const role = (await app.query(`SELECT current_user AS u, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0];
    record("runtime connects as sehat_app without BYPASSRLS/SUPERUSER", role.u === "sehat_app" && !role.rolbypassrls && !role.rolsuper, `user=${role.u}`);
    const noRls = (await admin.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`)).rows.map((r) => r.relname);
    record("RLS enabled on every public table", noRls.length === 0, noRls.join(", ") || "all tables");

    // Ground truth, computed as postgres (bypasses RLS).
    const truth = {
      patientsA: await count(admin, `SELECT count(*) n FROM patients WHERE "clinicId" = $1`, [CLINIC_A]),
      wakadAppts: await count(admin, `SELECT count(*) n FROM appointments WHERE "branchId" = $1`, [BRANCH_A_WAKAD]),
      wakadInvoices: await count(admin, `SELECT count(*) n FROM invoices WHERE "branchId" = $1`, [BRANCH_A_WAKAD]),
      doc1Appts: await count(admin, `SELECT count(*) n FROM appointments WHERE "doctorId" = $1`, [DOCTOR_1]),
      doc1Patients: await count(admin, `SELECT count(DISTINCT "patientId") n FROM appointments WHERE "doctorId" = $1`, [DOCTOR_1]),
      doc1Consults: await count(admin, `SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1`, [DOCTOR_1]),
      portalAppts: await count(admin, `SELECT count(*) n FROM appointments WHERE "patientId" = $1`, [PORTAL_PATIENT]),
      portalInvoices: await count(admin, `SELECT count(*) n FROM invoices WHERE "patientId" = $1`, [PORTAL_PATIENT]),
      doc2Appt: (await admin.query(`SELECT id FROM appointments WHERE "doctorId" = $1 LIMIT 1`, [DOCTOR_2])).rows[0]?.id as string | undefined,
      otherPatient: (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND id <> $2 LIMIT 1`, [CLINIC_A, PORTAL_PATIENT])).rows[0]?.id as string,
      portalLinked: (await admin.query(`SELECT "userId" FROM patients WHERE id = $1`, [PORTAL_PATIENT])).rows[0]?.userId === PORTAL_USER,
    };
    if (!truth.patientsA || !truth.doc2Appt || !truth.portalLinked) throw new Error("Demo fixtures missing. Run `npm run db:seed` first.");

    // --- Default deny / forged context ------------------------------------------------------------
    await inTx(app, {}, async () => {
      const n = await count(app, `SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM appointments) + (SELECT count(*) FROM invoices) + (SELECT count(*) FROM users) + (SELECT count(*) FROM audit_events) n`);
      record("no context → no rows", n === 0, `${n} visible`);
    });
    await inTx(app, { clinic_id: CLINIC_A }, async () => {
      const n = await count(app, `SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM appointments) n`);
      record("clinic id without a member user → no rows", n === 0, `${n} visible`);
    });
    await inTx(app, { user_id: ADMIN_B, clinic_id: CLINIC_A }, async () => {
      const n = await count(app, `SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM appointments) + (SELECT count(*) FROM invoices) n`);
      record("clinic B admin with forged clinic A context → no rows", n === 0, `${n} visible`);
    });

    // --- Clinic administrator ---------------------------------------------------------------------
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const patients = await count(app, `SELECT count(*) n FROM patients`);
      const foreign = await count(app, `SELECT (SELECT count(*) FROM patients WHERE "clinicId" <> $1) + (SELECT count(*) FROM appointments WHERE "clinicId" <> $1) + (SELECT count(*) FROM invoices WHERE "clinicId" <> $1) + (SELECT count(*) FROM prescriptions WHERE "clinicId" <> $1) n`, [CLINIC_A]);
      record("admin sees all of their clinic's patients", patients === truth.patientsA, `${patients}/${truth.patientsA}`);
      record("admin sees nothing from another clinic", foreign === 0, `${foreign} foreign rows`);
      const ins = await attempt(app, `INSERT INTO patients (id, "clinicId", "branchId", "patientNumber", name, "dateOfBirth", gender, phone, "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'RLS-TEST', 'RLS Test', '2000-01-01', 'OTHER', '+91 00000 99999', now())`, [CLINIC_B, demoId("branch:NIR-IND")]);
      record("insert into another clinic is rejected", !ins.ok && /row-level security/i.test(ins.message), short(ins.message));
      const del = await attempt(app, `DELETE FROM appointments WHERE "clinicId" = $1`, [CLINIC_A]);
      record("runtime role cannot DELETE records", !del.ok && /permission denied/i.test(del.message), short(del.message));
    });

    // --- Branch-restricted receptionist -------------------------------------------------------------
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A }, async () => {
      const n = await count(app, `SELECT (SELECT count(*) FROM appointments) + (SELECT count(*) FROM invoices) n`);
      record("branch-restricted user without branch scope → no appointments/invoices", n === 0, `${n} visible`);
    });
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_KOTHRUD }, async () => {
      const n = await count(app, `SELECT count(*) n FROM appointments`);
      record("branch-restricted user claiming another branch → no rows", n === 0, `${n} visible`);
    });
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD }, async () => {
      const appts = await count(app, `SELECT count(*) n FROM appointments`);
      const other = await count(app, `SELECT count(*) n FROM appointments WHERE "branchId" <> $1`, [BRANCH_A_WAKAD]);
      const invoices = await count(app, `SELECT count(*) n FROM invoices`);
      const consults = await count(app, `SELECT (SELECT count(*) FROM consultations) + (SELECT count(*) FROM prescriptions) n`);
      record("receptionist sees only their branch's appointments", appts === truth.wakadAppts && other === 0, `${appts}/${truth.wakadAppts}`);
      record("receptionist sees only their branch's invoices", invoices === truth.wakadInvoices, `${invoices}/${truth.wakadInvoices}`);
      record("front-desk role cannot read clinical notes or prescriptions", consults === 0, `${consults} visible`);
      const move = await attempt(app, `UPDATE appointments SET "branchId" = $1 WHERE "branchId" = $2`, [BRANCH_A_KOTHRUD, BRANCH_A_WAKAD]);
      record("cannot move a record outside the branch restriction", !move.ok && /row-level security/i.test(move.message), short(move.message));
    });

    // --- Doctor (own_appointments.view / assigned_patients.view only) ---------------------------------
    await inTx(app, { user_id: DOCTOR_1_USER, clinic_id: CLINIC_A }, async () => {
      const appts = await count(app, `SELECT count(*) n FROM appointments`);
      const notMine = await count(app, `SELECT count(*) n FROM appointments WHERE "doctorId" <> $1`, [DOCTOR_1]);
      const patients = await count(app, `SELECT count(*) n FROM patients`);
      const consults = await count(app, `SELECT count(*) n FROM consultations`);
      const invoices = await count(app, `SELECT count(*) n FROM invoices`);
      const otherAppt = await count(app, `SELECT count(*) n FROM appointments WHERE id = $1`, [truth.doc2Appt]);
      record("doctor sees only their own appointments", appts === truth.doc1Appts && notMine === 0, `${appts}/${truth.doc1Appts}`);
      record("doctor sees only patients they have appointments with", patients === truth.doc1Patients, `${patients}/${truth.doc1Patients}`);
      record("doctor sees only consultations from their appointments", consults === truth.doc1Consults, `${consults}/${truth.doc1Consults}`);
      record("doctor cannot read another doctor's appointment by id", otherAppt === 0, `${otherAppt} rows`);
      record("doctor without billing permission sees no invoices", invoices === 0, `${invoices} visible`);
      const upd = await attempt(app, `UPDATE appointments SET notes = 'x' WHERE id = $1`, [truth.doc2Appt]);
      record("doctor cannot update another doctor's appointment", upd.ok && upd.rowCount === 0, upd.ok ? `${upd.rowCount} rows updated` : short(upd.message));
      const reassign = await attempt(app, `UPDATE appointments SET "doctorId" = $1 WHERE "doctorId" = $2`, [DOCTOR_2, DOCTOR_1]);
      record("doctor cannot hand their appointment to another doctor", !reassign.ok && /row-level security/i.test(reassign.message), short(reassign.message));
    });

    // --- Patient portal user -------------------------------------------------------------------------
    await inTx(app, { user_id: PORTAL_USER, clinic_id: CLINIC_A }, async () => {
      const patients = (await app.query(`SELECT id FROM patients`)).rows.map((r) => r.id);
      const appts = await count(app, `SELECT count(*) n FROM appointments`);
      const foreignAppts = await count(app, `SELECT count(*) n FROM appointments WHERE "patientId" <> $1`, [PORTAL_PATIENT]);
      const invoices = await count(app, `SELECT count(*) n FROM invoices`);
      const foreignInv = await count(app, `SELECT count(*) n FROM invoices WHERE "patientId" <> $1`, [PORTAL_PATIENT]);
      const foreignClinical = await count(app, `SELECT count(*) n FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."patientId" <> $1`, [PORTAL_PATIENT]);
      const otherById = await count(app, `SELECT count(*) n FROM patients WHERE id = $1`, [truth.otherPatient]);
      const staffRows = await count(app, `SELECT count(*) n FROM clinic_memberships WHERE "userId" <> $1`, [PORTAL_USER]);
      const nonDoctorUsers = await count(app, `SELECT count(*) n FROM users u WHERE u.id <> $1 AND NOT EXISTS (SELECT 1 FROM doctor_profiles d WHERE d."userId" = u.id)`, [PORTAL_USER]);
      record("patient sees only their own patient record", patients.length === 1 && patients[0] === PORTAL_PATIENT, `${patients.length} visible`);
      record("patient sees only their own appointments", appts === truth.portalAppts && foreignAppts === 0, `${appts}/${truth.portalAppts}`);
      record("patient sees only their own invoices", invoices === truth.portalInvoices && foreignInv === 0, `${invoices}/${truth.portalInvoices}`);
      record("patient sees no one else's clinical records", foreignClinical === 0, `${foreignClinical} leaked`);
      record("patient cannot read another patient by id", otherById === 0, `${otherById} rows`);
      record("patient cannot list staff memberships or other users", staffRows === 0 && nonDoctorUsers === 0, `memberships=${staffRows} users=${nonDoctorUsers}`);
      const upd = await attempt(app, `UPDATE patients SET city = 'x' WHERE id = $1`, [PORTAL_PATIENT]);
      record("patient cannot edit records directly", upd.ok && upd.rowCount === 0, upd.ok ? `${upd.rowCount} rows updated` : short(upd.message));
    });
    await inTx(app, { user_id: PORTAL_USER, clinic_id: CLINIC_B }, async () => {
      const n = await count(app, `SELECT (SELECT count(*) FROM appointments) + (SELECT count(*) FROM invoices) + (SELECT count(*) FROM consultations) n`);
      record("patient with a forged other-clinic context → no rows", n === 0, `${n} visible`);
    });

    // --- Context isolation between transactions --------------------------------------------------------
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => undefined);
    const leaked = (await app.query(`SELECT current_setting('app.clinic_id', true) AS c, current_setting('app.user_id', true) AS u`)).rows[0];
    const after = await count(app, `SELECT count(*) n FROM patients`);
    record("tenant context is cleared after each transaction", !leaked.c && !leaked.u && after === 0, `clinic=${JSON.stringify(leaked.c)} rows=${after}`);

    // --- Audit trail ------------------------------------------------------------------------------------
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const direct = await attempt(app, `INSERT INTO audit_events (action, outcome) VALUES ('x.y', 'SUCCESS')`);
      record("runtime role cannot write audit rows directly", !direct.ok && /permission denied/i.test(direct.message), short(direct.message));
      await app.query(`SELECT app.log_event('access.denied', 'DENIED', 'route', '/billing', 'FORBIDDEN', NULL, '127.0.0.1', '{"path":"/billing"}')`);
      const logged = (await app.query(`SELECT "actorUserId", "clinicId", outcome FROM audit_events WHERE action = 'access.denied' ORDER BY "occurredAt" DESC LIMIT 1`)).rows[0];
      record("log_event records the verified actor and clinic", logged?.actorUserId === ADMIN_A && logged?.clinicId === CLINIC_A && logged?.outcome === "DENIED", JSON.stringify(logged ?? {}));
      const upd = await app.query(`UPDATE patients SET city = 'AuditCheckCity' WHERE id = $1`, [PORTAL_PATIENT]);
      const ev = (await app.query(`SELECT metadata, "actorUserId" FROM audit_events WHERE action = 'patients.update' AND "targetId" = $1 ORDER BY "occurredAt" DESC LIMIT 1`, [PORTAL_PATIENT])).rows[0];
      record(
        "clinical changes are audited with column names only (no values)",
        upd.rowCount === 1 && ev?.actorUserId === ADMIN_A && JSON.stringify(ev?.metadata) === '{"changed":["city"]}',
        JSON.stringify(ev?.metadata ?? {})
      );
      const tamper = await attempt(app, `UPDATE audit_events SET outcome = 'SUCCESS'`);
      record("runtime role cannot modify audit rows", !tamper.ok && /permission denied/i.test(tamper.message), short(tamper.message));
    });
    await inTx(admin, {}, async () => {
      const del = await attempt(admin, `DELETE FROM audit_events`);
      const upd = await attempt(admin, `UPDATE audit_events SET reason = 'x'`);
      const trunc = await attempt(admin, `TRUNCATE audit_events`);
      record(
        "audit rows are immutable even for postgres",
        [del, upd, trunc].every((r) => !r.ok && /append-only/.test(r.message)),
        short(del.message)
      );
    });
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD }, async () => {
      const n = await count(app, `SELECT count(*) n FROM audit_events`);
      record("non-admin staff cannot read the audit trail", n === 0, `${n} visible`);
    });

    // --- Billing -------------------------------------------------------------------------------------
    const maxInvoice = await count(admin, `SELECT coalesce(max(substr("invoiceNumber", 9)::int), 0) n FROM invoices WHERE "clinicId" = $1 AND "invoiceNumber" ~ '^AAR-INV-[0-9]+$'`, [CLINIC_A]);
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const next = (await app.query(`SELECT app.next_document_number('invoice') AS n`)).rows[0].n as string;
      record("invoice numbering continues the clinic-wide series", next === `AAR-INV-${String(maxInvoice + 1).padStart(4, "0")}`, next);
      const bad = await attempt(app, `SELECT app.next_document_number('patient')`);
      record("numbering rejects unknown document kinds", !bad.ok, short(bad.message));
    });
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD }, async () => {
      const num = await attempt(app, `SELECT app.next_document_number('invoice')`);
      record("staff without invoice.create cannot take invoice numbers", !num.ok && /not permitted/.test(num.message), short(num.message));
      const insert = await attempt(
        app,
        `INSERT INTO invoices (id, "clinicId", "branchId", "patientId", "invoiceNumber", "issuedAt", "subtotalPaise", "totalPaise", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'RLS-TEST', now(), 0, 0, now())`,
        [CLINIC_A, BRANCH_A_WAKAD, PORTAL_PATIENT]
      );
      record("staff without invoice.create cannot insert invoices", !insert.ok && /row-level security/i.test(insert.message), short(insert.message));
      const refund = await attempt(app, `UPDATE payments SET status = 'REFUNDED' WHERE "clinicId" = $1 AND status = 'SUCCEEDED'`, [CLINIC_A]);
      record("staff without refund.manage cannot mark payments refunded", refund.ok && refund.rowCount === 0, refund.ok ? `${refund.rowCount} rows updated` : short(refund.message));
      const del = await attempt(app, `DELETE FROM payments WHERE "clinicId" = $1`, [CLINIC_A]);
      record("runtime role cannot delete payments", !del.ok && /permission denied/i.test(del.message), short(del.message));
    });

    // --- Clinical authoring: assigned doctor only ----------------------------------------------------
    const doc2Consult = (await admin.query(`SELECT c.id FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1 LIMIT 1`, [DOCTOR_2])).rows[0]?.id as string | undefined;
    const doc1Consult = (await admin.query(`SELECT c.id FROM consultations c JOIN appointments a ON a.id = c."appointmentId" WHERE a."doctorId" = $1 LIMIT 1`, [DOCTOR_1])).rows[0]?.id as string | undefined;
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const upd = await attempt(app, `UPDATE consultations SET notes = notes WHERE id = $1`, [doc2Consult]);
      record("administrators cannot edit clinical notes (read-only)", upd.ok && upd.rowCount === 0, upd.ok ? `${upd.rowCount} rows updated` : short(upd.message));
      const ins = await attempt(app, `INSERT INTO prescriptions (id, "clinicId", "consultationId", "prescriptionNumber", "issuedAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'RLS-TEST', now(), now())`, [CLINIC_A, doc2Consult]);
      record("administrators cannot issue prescriptions", !ins.ok && /row-level security/i.test(ins.message), short(ins.message));
    });
    await inTx(app, { user_id: DOCTOR_1_USER, clinic_id: CLINIC_A }, async () => {
      const own = await attempt(app, `UPDATE consultations SET notes = notes WHERE id = $1`, [doc1Consult]);
      record("the assigned doctor can edit their consultation", own.ok && own.rowCount === 1, own.ok ? `${own.rowCount} rows updated` : short(own.message));
      const other = await attempt(app, `INSERT INTO prescriptions (id, "clinicId", "consultationId", "prescriptionNumber", "issuedAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'RLS-TEST', now(), now())`, [CLINIC_A, doc2Consult]);
      record("a doctor cannot prescribe on another doctor's consultation", !other.ok && /row-level security/i.test(other.message), short(other.message));
    });

    // --- Inventory (all rows created here are rolled back) -------------------------------------------
    const MANAGER_WAKAD = demoId("user:ST-02"); // Aarogya clinic manager, Wakad only: pharmacy.inventory.view
    const medicineId = (await admin.query(`SELECT id FROM medicines WHERE "isActive" ORDER BY name LIMIT 1`)).rows[0].id as string;
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const item = (await app.query(
        `INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "updatedAt")
         VALUES ($1, $2, $3, 'RLS-TEST', (now() AT TIME ZONE 'Asia/Kolkata')::date + 90, now()) RETURNING id`,
        [CLINIC_A, BRANCH_A_KOTHRUD, medicineId]
      )).rows[0].id as string;
      const receipt = (await app.query(
        `INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId") VALUES ($1, $2, $3, 'RECEIPT', 10, $4) RETURNING id, "quantityAfter"`,
        [CLINIC_A, BRANCH_A_KOTHRUD, item, ADMIN_A]
      )).rows[0];
      const qty = (await app.query(`SELECT "quantityOnHand" q FROM inventory_items WHERE id = $1`, [item])).rows[0].q;
      record("a receipt movement updates quantity atomically", qty === 10 && receipt.quantityAfter === 10, `on hand ${qty}, after ${receipt.quantityAfter}`);
      const direct = await attempt(app, `UPDATE inventory_items SET "quantityOnHand" = 999 WHERE id = $1`, [item]);
      record("runtime role cannot set stock quantity directly", !direct.ok && /permission denied/i.test(direct.message), short(direct.message));
      const negative = await attempt(app, `INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", reason) VALUES ($1, $2, $3, 'ADJUSTMENT', -11, $4, 'RLS test')`, [CLINIC_A, BRANCH_A_KOTHRUD, item, ADMIN_A]);
      record("stock cannot go negative", !negative.ok && /insufficient stock/i.test(negative.message), short(negative.message));
      const dup = await attempt(app, `INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "updatedAt") VALUES ($1, $2, $3, ' rls-test ', (now() AT TIME ZONE 'Asia/Kolkata')::date + 90, now())`, [CLINIC_A, BRANCH_A_KOTHRUD, medicineId]);
      record("duplicate batch (case/space-insensitive) is rejected", !dup.ok && /inventory_items_batch_key|duplicate/i.test(dup.message), short(dup.message));
      const rev = await attempt(app, `INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", "reversesMovementId") VALUES ($1, $2, $3, 'REVERSAL', -10, $4, $5)`, [CLINIC_A, BRANCH_A_KOTHRUD, item, ADMIN_A, receipt.id]);
      // Applied once (inside a savepoint that was rolled back), so apply it for real now, then try again:
      await app.query(`INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", "reversesMovementId") VALUES ($1, $2, $3, 'REVERSAL', -10, $4, $5)`, [CLINIC_A, BRANCH_A_KOTHRUD, item, ADMIN_A, receipt.id]);
      const again = await attempt(app, `INSERT INTO stock_movements ("clinicId", "branchId", "inventoryItemId", type, "quantityDelta", "actorUserId", "reversesMovementId") VALUES ($1, $2, $3, 'REVERSAL', -10, $4, $5)`, [CLINIC_A, BRANCH_A_KOTHRUD, item, ADMIN_A, receipt.id]);
      record("a movement can be reversed only once", rev.ok && !again.ok, short(again.message));
      const edit = await attempt(app, `UPDATE stock_movements SET "quantityDelta" = 1 WHERE id = $1`, [receipt.id]);
      record("stock movements cannot be edited by the runtime role", !edit.ok && /permission denied/i.test(edit.message), short(edit.message));
      // Switch to the Wakad clinic manager within the same transaction (the Kothrud batch above is still there, uncommitted).
      await app.query(`SELECT set_config('app.user_id', $1, true), set_config('app.branch_id', $2, true)`, [MANAGER_WAKAD, BRANCH_A_WAKAD]);
      const seen = await count(app, `SELECT count(*) n FROM inventory_items WHERE id = $1`, [item]);
      record("clinic manager cannot see another branch's stock", seen === 0, `${seen} visible`);
      const mgrWrite = await attempt(app, `INSERT INTO inventory_items ("clinicId", "branchId", "medicineId", "batchNumber", "expiryDate", "updatedAt") VALUES ($1, $2, $3, 'RLS-MGR', (now() AT TIME ZONE 'Asia/Kolkata')::date + 90, now())`, [CLINIC_A, BRANCH_A_WAKAD, medicineId]);
      record("clinic manager (view-only) cannot create stock records", !mgrWrite.ok && /row-level security/i.test(mgrWrite.message), short(mgrWrite.message));
    });
    await admin.query("BEGIN");
    try {
      const truncate = await attempt(admin, `TRUNCATE stock_movements`);
      record("stock movements are append-only even for postgres", !truncate.ok && /append-only/i.test(truncate.message), short(truncate.message));
    } finally {
      await admin.query("ROLLBACK");
    }

    // --- Shared medicine catalogue (rolled back) -----------------------------------------------------
    const catalogHolders = (await admin.query(
      `SELECT coalesce(string_agg(r.key::text, ',' ORDER BY r.key::text), '') v FROM role_permissions rp JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId" WHERE p.key = 'medicine.catalog.create'`
    )).rows[0].v;
    record("only ADMINISTRATOR holds medicine.catalog.create", catalogHolders === "ADMINISTRATOR", catalogHolders);
    await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
      const direct = await attempt(app, `INSERT INTO medicines (id, name, "genericName", strength, "dosageForm", "updatedAt") VALUES (gen_random_uuid(), 'RLS Direct', 'Rls', '1 mg', 'TABLET', now())`);
      record("runtime role cannot insert into the medicine catalogue directly", !direct.ok && /permission denied/i.test(direct.message), short(direct.message));
      // attempt() always rolls back its savepoint, so the first entry is created with a plain query
      // (still inside the transaction inTx rolls back), then the duplicate is attempted.
      const createdId = (await app.query(`SELECT app.create_catalog_medicine('RLS Catalog Test', 'Rlsamide', '5 mg', 'TABLET') AS id`)).rows[0].id as string;
      const dup = await attempt(app, `SELECT app.create_catalog_medicine(' rls   catalog TEST ', 'Other', '5mg', 'TABLET')`);
      record("administrator adds through the function; normalised duplicates are refused", Boolean(createdId) && !dup.ok && /duplicate/i.test(dup.message), short(dup.message));
    });
    await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD }, async () => {
      const refused = await attempt(app, `SELECT app.create_catalog_medicine('RLS Catalog Test 2', 'Rlsamide', '5 mg', 'TABLET')`);
      record("non-administrators are refused by the catalogue function", !refused.ok && /not permitted/i.test(refused.message), short(refused.message));
    });

    // --- P5: notifications and staff invitations (once migrations 20261019000000/…100 are applied) -----
    const p5 = (await admin.query(`SELECT to_regclass('public.notifications') IS NOT NULL AS n, to_regclass('public.staff_invitations') IS NOT NULL AS i`)).rows[0];
    if (!p5.n || !p5.i) {
      console.log("P5 checks skipped: the notifications/staff invitation migrations are not applied to this database.");
    } else {
      const MANAGER_WAKAD_P5 = demoId("user:ST-02");
      const NURSE_KOTHRUD = demoId("user:ST-05");
      const specialtyId = (await admin.query(`SELECT id FROM specialties ORDER BY name LIMIT 1`)).rows[0]?.id as string;
      // A Wakad patient for a fresh appointment booked inside the rolled-back transaction below.
      const p5Patient = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "branchId" = $2 ORDER BY "patientNumber" LIMIT 1`, [CLINIC_A, BRANCH_A_WAKAD])).rows[0]?.id as string | undefined;
      const pin = (user: string, clinic: string, branch = "") =>
        app.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true)`, [user, clinic, branch]);

      await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
        // Least privilege: no direct writes, internal helpers not executable.
        const insNotif = await attempt(app, `INSERT INTO notifications ("clinicId", scope, "recipientUserId", type) VALUES ($1, 'PERSONAL', $2, 'APPOINTMENT_BOOKED')`, [CLINIC_A, ADMIN_A]);
        record("P5: runtime role cannot insert notifications directly", !insNotif.ok && /permission denied/i.test(insNotif.message), short(insNotif.message));
        const addFn = await attempt(app, `SELECT app.add_notification($1, 'PERSONAL', $2, NULL, NULL, 'APPOINTMENT_BOOKED', NULL, '{}'::jsonb)`, [CLINIC_A, DOCTOR_1_USER]);
        record("P5: runtime role cannot call app.add_notification", !addFn.ok && /permission denied/i.test(addFn.message), short(addFn.message));
        const readAt = await attempt(app, `INSERT INTO notification_reads ("userId", "notificationId", "readAt") VALUES ($1, gen_random_uuid(), now())`, [ADMIN_A]);
        record("P5: runtime role cannot set readAt on read receipts", !readAt.ok && /permission denied/i.test(readAt.message), short(readAt.message));
        const insInv = await attempt(app, `INSERT INTO staff_invitations (id) VALUES (gen_random_uuid())`);
        const helpers = await attempt(app, `SELECT app.require_inviter()`);
        record(
          "P5: runtime role cannot write invitations directly or call internal helpers",
          !insInv.ok && /permission denied/i.test(insInv.message) && !helpers.ok && /permission denied/i.test(helpers.message),
          short(insInv.message)
        );

        // 20261020000000 adds a required p_phone (5th parameter); pass it only when this database has it.
        const hasPhone = Boolean((await admin.query(`SELECT to_regprocedure('app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean)') IS NOT NULL AS ok`)).rows[0].ok);
        const PH = hasPhone ? ", '+919800000001'" : "";
        // Role, branch and scope rules (inside the database function).
        const adminRole = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-a@example.com', 'RLS Admin', 'ADMINISTRATOR', $1${PH})`, [BRANCH_A_WAKAD]);
        const patientRole = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-p@example.com', 'RLS Patient', 'PATIENT', $1${PH})`, [BRANCH_A_WAKAD]);
        record("P5: Administrator and Patient are never invitable", /ROLE_NOT_INVITABLE/.test(adminRole.message) && /ROLE_NOT_INVITABLE/.test(patientRole.message), short(adminRole.message));
        const foreignBranch = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-b@example.com', 'RLS Branch', 'NURSE', $1${PH})`, [demoId("branch:NIR-IND")]);
        record("P5: a branch of another clinic is refused", /INVALID_BRANCH/.test(foreignBranch.message), short(foreignBranch.message));
        const patientEmail = (await admin.query(`SELECT email FROM users WHERE id = $1`, [PORTAL_USER])).rows[0].email as string;
        const convert = await attempt(app, `SELECT app.create_staff_invitation($1, 'RLS Convert', 'NURSE', $2${PH})`, [patientEmail, BRANCH_A_WAKAD]);
        record("P5: a patient of the same clinic is never invited (no conversion)", /ALREADY_PATIENT/.test(convert.message), short(convert.message));

        const invId = (await app.query(`SELECT app.create_staff_invitation('RLS-P5-Invitee@Example.com', 'RLS Invitee', 'RECEPTIONIST', $1${PH})::text AS id`, [BRANCH_A_WAKAD])).rows[0].id as string;
        const dup = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-invitee@example.com', 'RLS Invitee', 'RECEPTIONIST', $1${PH})`, [BRANCH_A_WAKAD]);
        record("P5: duplicate invitation (case-insensitive) is refused", /ALREADY_INVITED/.test(dup.message), short(dup.message));
        if (hasPhone) {
          const badPhone = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-ph@example.com', 'RLS Phone', 'NURSE', $1, '98000 00001')`, [BRANCH_A_WAKAD]);
          record("P5: an invitation without a valid E.164 phone is refused (number not echoed)", /INVALID_PHONE/.test(badPhone.message) && !/98000/.test(badPhone.message), short(badPhone.message));
        }
        const pendingMembers = await count(app, `SELECT count(*) n FROM clinic_memberships WHERE "userId" = (SELECT "userId" FROM staff_invitations WHERE id = $1)`, [invId]);
        record("P5: a pending invitation creates no membership", pendingMembers === 0, `${pendingMembers} memberships`);

        const docId = (await app.query(
          `SELECT app.create_staff_invitation('rls-p5-doctor@example.com', 'RLS Doctor', 'DOCTOR', $1${PH}, p_specialty_id => $2, p_qualifications => 'MBBS', p_registration_number => 'RLS-P5-REG-1', p_experience_years => 5, p_consultation_fee_paise => 50000, p_online_consultation => false)::text AS id`,
          [BRANCH_A_KOTHRUD, specialtyId]
        )).rows[0].id as string;
        const docProfiles = await count(app, `SELECT count(*) n FROM doctor_profiles WHERE "registrationNumber" = 'RLS-P5-REG-1'`);
        record("P5: a pending doctor invitation creates no doctor profile", Boolean(docId) && docProfiles === 0, `${docProfiles} profiles`);

        await pin(ADMIN_B, CLINIC_B);
        const crossSeen = await count(app, `SELECT count(*) n FROM staff_invitations WHERE id IN ($1, $2)`, [invId, docId]);
        const crossResend = await attempt(app, `SELECT app.resend_staff_invitation($1)`, [invId]);
        record("P5: another clinic's administrator can't see or act on invitations", crossSeen === 0 && /NOT_FOUND/.test(crossResend.message), `${crossSeen} visible; ${short(crossResend.message)}`);

        await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
        const recSeen = await count(app, `SELECT count(*) n FROM staff_invitations`);
        const recCreate = await attempt(app, `SELECT app.create_staff_invitation('rls-p5-r@example.com', 'RLS R', 'NURSE', $1${PH})`, [BRANCH_A_WAKAD]);
        record("P5: receptionists can't see or create invitations", recSeen === 0 && /NOT_PERMITTED/.test(recCreate.message), `${recSeen} visible; ${short(recCreate.message)}`);

        await pin(MANAGER_WAKAD_P5, CLINIC_A, BRANCH_A_WAKAD);
        const mgrSeen = (await app.query(`SELECT id FROM staff_invitations`)).rows.map((r) => r.id as string);
        const mgrRevoke = await attempt(app, `SELECT app.revoke_staff_invitation($1)`, [invId]);
        record(
          "P5: clinic manager sees own-branch invitations only, read-only",
          mgrSeen.includes(invId) && !mgrSeen.includes(docId) && /NOT_PERMITTED/.test(mgrRevoke.message),
          `${mgrSeen.length} visible; ${short(mgrRevoke.message)}`
        );

        // Staff phone: never writable directly; app.set_staff_phone (20261020000100) is Administrators-only and clinic-scoped.
        await pin(ADMIN_A, CLINIC_A);
        const directPhone = await attempt(app, `UPDATE users SET phone = '+919800000001' WHERE id = $1`, [RECEPTION_WAKAD]);
        record("Staff phone: runtime role cannot update users directly", !directPhone.ok && /permission denied/i.test(directPhone.message), short(directPhone.message));
        const hasPhoneEdit = Boolean((await admin.query(`SELECT to_regprocedure('app.set_staff_phone(uuid, text)') IS NOT NULL AS ok`)).rows[0].ok);
        if (hasPhoneEdit) {
          const recMembership = (await admin.query(`SELECT id FROM clinic_memberships WHERE "userId" = $1 AND "clinicId" = $2`, [RECEPTION_WAKAD, CLINIC_A])).rows[0].id as string;
          await pin(MANAGER_WAKAD_P5, CLINIC_A, BRANCH_A_WAKAD);
          const mgrPhone = await attempt(app, `SELECT app.set_staff_phone($1, '+919800000001')`, [recMembership]);
          await pin(ADMIN_B, CLINIC_B);
          const crossPhone = await attempt(app, `SELECT app.set_staff_phone($1, '+919800000001')`, [recMembership]);
          record(
            "Staff phone: only Administrators of the same clinic may set it (manager refused, other clinic NOT_FOUND)",
            /staff phone: NOT_PERMITTED/.test(mgrPhone.message) && /staff phone: NOT_FOUND/.test(crossPhone.message),
            `${short(mgrPhone.message)}; ${short(crossPhone.message)}`
          );
        }

        // Notifications: created by the trigger, visible to the recipient only.
        if (!p5Patient) {
          record("P5: notification checks have a Wakad patient fixture", false, "no Wakad patient — run npm run db:seed");
        } else {
          // Book (as the Wakad receptionist, through RLS) and check in, all inside this rolled-back transaction.
          await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
          const p5Appt = (await app.query(
            `INSERT INTO appointments (id, "clinicId", "branchId", "patientId", "doctorId", "startsAt", reason, "updatedAt")
             VALUES (gen_random_uuid(), $1, $2, $3, $4, date_trunc('day', now()) + interval '40 days 3 hours 17 minutes', 'RLS P5 check', now()) RETURNING id`,
            [CLINIC_A, BRANCH_A_WAKAD, p5Patient, DOCTOR_1]
          )).rows[0].id as string;
          await app.query(`UPDATE appointments SET status = 'CHECKED_IN', "checkedInAt" = now() WHERE id = $1`, [p5Appt]);
          await pin(DOCTOR_1_USER, CLINIC_A);
          const docNotes = (await app.query(`SELECT id FROM notifications WHERE type = 'APPOINTMENT_CHECKED_IN' AND "refId" = $1`, [p5Appt])).rows;
          const keysOk = (await app.query(
            `SELECT coalesce(bool_and(k = ANY (ARRAY['startsAt','previousStartsAt','branchId','reason','medicineName','usable','reorderLevel','role'])), true) AS ok
               FROM notifications n, jsonb_object_keys(n.data) k WHERE n."refId" = $1`,
            [p5Appt]
          )).rows[0].ok;
          record("P5: check-in notifies the assigned doctor with allow-listed data only", docNotes.length === 1 && keysOk === true, `${docNotes.length} notification(s)`);
          const ownRead = await attempt(app, `INSERT INTO notification_reads ("userId", "notificationId") VALUES ($1, $2)`, [DOCTOR_1_USER, docNotes[0]?.id]);
          const otherRead = await attempt(app, `INSERT INTO notification_reads ("userId", "notificationId") VALUES ($1, $2)`, [ADMIN_A, docNotes[0]?.id]);
          record("P5: users can mark only their own notifications read", ownRead.ok && !otherRead.ok && /row-level security/i.test(otherRead.message), short(otherRead.message));
          await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
          const recNotes = await count(app, `SELECT count(*) n FROM notifications WHERE "refId" = $1`, [p5Appt]);
          await pin(NURSE_KOTHRUD, CLINIC_A, BRANCH_A_KOTHRUD);
          const nurseNotes = await count(app, `SELECT count(*) n FROM notifications WHERE "refId" = $1`, [p5Appt]);
          await pin(ADMIN_B, CLINIC_B);
          const foreignNotes = await count(app, `SELECT count(*) n FROM notifications`);
          await pin(PORTAL_USER, CLINIC_A);
          const patientNotes = await count(app, `SELECT count(*) n FROM notifications`);
          record(
            "P5: other staff, other clinics and patients don't see a doctor's notification",
            recNotes + nurseNotes + foreignNotes + patientNotes === 0,
            `${recNotes}/${nurseNotes}/${foreignNotes}/${patientNotes}`
          );
        }
      });
    }

    // --- P6.2: lab reports and patient documents (once migration 20261021000000 is applied) ------------
    // Every row is created through the SECURITY DEFINER entry points as sehat_app, inside one transaction
    // that inTx rolls back; nothing is committed and no file is stored anywhere.
    const p62 = (await admin.query(`SELECT to_regclass('public.patient_documents') IS NOT NULL AND to_regclass('public.lab_reports') IS NOT NULL AS ok`)).rows[0].ok;
    if (!p62) {
      console.log("P6.2 checks skipped: migration 20261021000000_patient_documents is not applied to this database.");
    } else {
      const MANAGER_WAKAD_P62 = demoId("user:ST-02");
      const NURSE_KOTHRUD_P62 = demoId("user:ST-05");
      const nurseActive = Boolean((await admin.query(`SELECT 1 FROM clinic_memberships WHERE "userId" = $1 AND status = 'ACTIVE'`, [NURSE_KOTHRUD_P62])).rowCount);
      const assigned = (await admin.query(`SELECT "patientId" AS id FROM appointments WHERE "doctorId" = $1 ORDER BY "startsAt" LIMIT 1`, [DOCTOR_1])).rows[0]?.id as string;
      const unassigned = (await admin.query(`SELECT p.id FROM patients p WHERE p."clinicId" = $1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a."patientId" = p.id AND a."doctorId" = $2) ORDER BY p."patientNumber" LIMIT 1`, [CLINIC_A, DOCTOR_1])).rows[0]?.id as string;
      const portalIsDoc1 = Boolean((await admin.query(`SELECT 1 FROM appointments WHERE "patientId" = $1 AND "doctorId" = $2`, [PORTAL_PATIENT, DOCTOR_1])).rowCount);
      const labPatient = portalIsDoc1 ? PORTAL_PATIENT : assigned;
      const SHA = "b".repeat(64);
      const pin = (user: string, clinic: string, branch = "") =>
        app.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true)`, [user, clinic, branch]);
      /** Registers an upload (plain query: the row must survive until inTx rolls back). */
      const upload = async (patientId: string, category: string, branchId: string | null = null) =>
        (await app.query(`SELECT document_id FROM app.begin_patient_document_upload($1, $2::"DocumentCategory", 'RLS P62', 'rls-p62.pdf', 'application/pdf', 1234, $3, $4)`,
          [patientId, category, SHA, branchId])).rows[0].document_id as string;
      const complete = (id: string) => app.query(`SELECT app.complete_patient_document_upload($1)`, [id]);
      const visibleDocs = async (ids: string[]) => new Set((await app.query(`SELECT id FROM patient_documents WHERE id = ANY ($1::uuid[])`, [ids])).rows.map((r) => r.id as string));

      await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, async () => {
        // Fixtures: one file per visibility case.
        await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
        const recClinical = await upload(unassigned, "LAB_REPORT"); // clinical, Wakad, unassigned patient
        const recAdmin = await upload(unassigned, "ID_PROOF"); //       administrative, Wakad
        await complete(recClinical);
        await complete(recAdmin);
        await pin(ADMIN_A, CLINIC_A);
        const kthAssigned = await upload(assigned, "IMAGING", BRANCH_A_KOTHRUD); //     clinical, Kothrud, DR-01's patient
        const kthUnassigned = await upload(unassigned, "IMAGING", BRANCH_A_KOTHRUD); // clinical, Kothrud, not DR-01's
        const kthAdmin = await upload(unassigned, "INSURANCE", BRANCH_A_KOTHRUD); //    administrative, Kothrud
        for (const id of [kthAssigned, kthUnassigned, kthAdmin]) await complete(id);
        const uploading = await upload(assigned, "IMAGING", BRANCH_A_KOTHRUD); //       left UPLOADING
        const failed = await upload(assigned, "IMAGING", BRANCH_A_KOTHRUD);
        await app.query(`SELECT app.fail_patient_document_upload($1, 'storage_error')`, [failed]);
        await pin(DOCTOR_1_USER, CLINIC_A);
        const drWakad = await upload(assigned, "IMAGING", BRANCH_A_WAKAD); //            clinical, Wakad, DR-01's patient
        await complete(drWakad);
        const all = [recClinical, recAdmin, kthAssigned, kthUnassigned, kthAdmin, uploading, failed, drWakad];
        const sees = async (expected: string[]) => {
          const v = await visibleDocs(all);
          return { ok: v.size === expected.length && expected.every((id) => v.has(id)), detail: `${v.size} visible, expected ${expected.length}` };
        };

        // Default deny and clinic isolation.
        await pin("", CLINIC_A);
        const noUser = await count(app, `SELECT (SELECT count(*) FROM patient_documents) + (SELECT count(*) FROM lab_reports) n`);
        await pin(ADMIN_B, CLINIC_A);
        const forged = await count(app, `SELECT (SELECT count(*) FROM patient_documents) + (SELECT count(*) FROM lab_reports) n`);
        await pin(ADMIN_B, CLINIC_B);
        const otherClinic = (await visibleDocs(all)).size;
        const crossArchive = await attempt(app, `SELECT app.archive_patient_document($1, 'DUPLICATE'::"DocumentArchiveReason", NULL)`, [kthAdmin]);
        const crossUpload = await attempt(app, `SELECT * FROM app.begin_patient_document_upload($1, 'ID_PROOF'::"DocumentCategory", 'RLS', 'rls.pdf', 'application/pdf', 1, $2)`, [unassigned, SHA]);
        record("P6.2: no user / forged clinic / other clinic → no documents or lab reports", noUser + forged + otherClinic === 0, `${noUser}/${forged}/${otherClinic}`);
        record("P6.2: functions refuse another clinic's documents and patients (NOT_FOUND)",
          /patient document: NOT_FOUND/.test(crossArchive.message) && /patient document: NOT_FOUND/.test(crossUpload.message), `${short(crossArchive.message)}; ${short(crossUpload.message)}`);

        // Role and branch rules, enforced by the RLS policies for the runtime role.
        await pin(ADMIN_A, CLINIC_A);
        let r = await sees([recClinical, recAdmin, kthAssigned, kthUnassigned, kthAdmin, drWakad]);
        record("P6.2: clinic-wide administrator sees every available file in both branches", r.ok, r.detail);
        await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
        r = await sees([recAdmin]);
        record("P6.2: receptionist sees own-branch administrative files only (clinical upload-only, even their own)", r.ok, r.detail);
        await pin(MANAGER_WAKAD_P62, CLINIC_A, BRANCH_A_WAKAD);
        r = await sees([recAdmin]);
        record("P6.2: clinic manager sees own-branch administrative files only, no clinical", r.ok, r.detail);
        await pin(DOCTOR_1_USER, CLINIC_A);
        r = await sees([kthAssigned, drWakad]);
        record("P6.2: doctor sees own patients' clinical files in both branches; not other patients, not administrative", r.ok, r.detail);
        if (nurseActive) {
          await pin(NURSE_KOTHRUD_P62, CLINIC_A, BRANCH_A_KOTHRUD);
          r = await sees([kthAssigned, kthUnassigned]);
          record("P6.2: nurse sees own-branch clinical files only; no other branch, no administrative", r.ok, r.detail);
        } else {
          console.log("P6.2 nurse check skipped: fixture ST-05 is not active.");
        }
        await pin(ADMIN_A, CLINIC_A);
        const hidden = await count(app, `SELECT count(*) n FROM patient_documents WHERE id IN ($1, $2)`, [uploading, failed]);
        await pin(DOCTOR_1_USER, CLINIC_A);
        const hiddenDr = await count(app, `SELECT count(*) n FROM patient_documents WHERE id IN ($1, $2)`, [uploading, failed]);
        record("P6.2: UPLOADING and FAILED files are never visible (administrator, uploader's assigned doctor)", hidden + hiddenDr === 0, `${hidden}/${hiddenDr}`);

        // No direct writes for the runtime role (even for a clinic-wide administrator).
        await pin(ADMIN_A, CLINIC_A);
        const dml = [
          await attempt(app, `INSERT INTO patient_documents (id) VALUES (gen_random_uuid())`),
          await attempt(app, `UPDATE patient_documents SET status = 'AVAILABLE' WHERE id = $1`, [uploading]),
          await attempt(app, `DELETE FROM patient_documents WHERE id = $1`, [kthAdmin]),
          await attempt(app, `INSERT INTO lab_reports (id) VALUES (gen_random_uuid())`),
          await attempt(app, `UPDATE lab_reports SET "sharedWithPatientAt" = now()`),
          await attempt(app, `DELETE FROM lab_reports`),
        ];
        record("P6.2: runtime role cannot INSERT, UPDATE or DELETE documents or lab reports directly",
          dml.every((d) => !d.ok && /permission denied/i.test(d.message)), dml.map((d) => (d.ok ? "ALLOWED" : "denied")).join(","));
        const internal = await attempt(app, `SELECT app.document_rate_limit()`);
        record("P6.2: runtime role cannot call internal document helpers", !internal.ok && /permission denied/i.test(internal.message), short(internal.message));

        // Lab reports: receptionist creates (upload-only), assigned doctor reviews and shares.
        await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
        const reportId = (await app.query(`SELECT app.create_lab_report($1, 'RLS test', 'RLS report') id`, [labPatient])).rows[0].id as string;
        const recReports = await count(app, `SELECT count(*) n FROM lab_reports WHERE id = $1`, [reportId]);
        const recValues = await attempt(app, `SELECT app.set_lab_report_values($1, '[{"parameter":"x"}]'::jsonb)`, [reportId]);
        await pin(MANAGER_WAKAD_P62, CLINIC_A, BRANCH_A_WAKAD);
        const mgrReports = await count(app, `SELECT count(*) n FROM lab_reports WHERE id = $1`, [reportId]);
        record("P6.2: receptionist creates a lab report but can't read it or enter values; clinic manager can't read it",
          recReports === 0 && !recValues.ok && mgrReports === 0, `${recReports}/${mgrReports}; ${short(recValues.message)}`);
        await pin(DOCTOR_1_USER, CLINIC_A);
        const drReports = await count(app, `SELECT count(*) n FROM lab_reports WHERE id = $1`, [reportId]);
        await app.query(`SELECT app.set_lab_report_values($1, '[{"parameter":"RLS param","value":"1"}]'::jsonb)`, [reportId]);
        await app.query(`SELECT app.review_lab_report($1)`, [reportId]);
        await pin(ADMIN_B, CLINIC_B);
        const crossReview = await attempt(app, `SELECT app.set_lab_report_shared($1, true)`, [reportId]);
        record("P6.2: assigned doctor reads and reviews; another clinic can't act on it", drReports === 1 && /lab report: NOT_FOUND/.test(crossReview.message), `${drReports}; ${short(crossReview.message)}`);
        await pin(PORTAL_USER, CLINIC_A);
        const portalBefore = await count(app, `SELECT (SELECT count(*) FROM lab_reports) + (SELECT count(*) FROM patient_documents) n`);
        if (portalIsDoc1) {
          await pin(DOCTOR_1_USER, CLINIC_A);
          await app.query(`SELECT app.set_lab_report_shared($1, true)`, [reportId]);
          await pin(PORTAL_USER, CLINIC_A);
          const portalAfter = (await app.query(`SELECT id FROM lab_reports`)).rows.map((x) => x.id as string);
          record("P6.2: patient sees no unshared reports or files; sees their own report only once reviewed and shared",
            portalBefore === 0 && portalAfter.length === 1 && portalAfter[0] === reportId, `${portalBefore} before, ${portalAfter.length} after sharing`);

          // P6.3 patient portal: of the patient's OWN files, only the shared report's result file is visible.
          await pin(DOCTOR_1_USER, CLINIC_A);
          const labFile = (await app.query(`SELECT document_id FROM app.begin_patient_document_upload($1, 'LAB_REPORT'::"DocumentCategory", 'RLS P63', 'rls.pdf', 'application/pdf', 10, $2, NULL, $3)`,
            [PORTAL_PATIENT, SHA.replace(/^b/, "d"), reportId])).rows[0].document_id as string;
          await app.query(`SELECT app.complete_patient_document_upload($1)`, [labFile]);
          await pin(RECEPTION_WAKAD, CLINIC_A, BRANCH_A_WAKAD);
          const idFile = (await app.query(`SELECT document_id FROM app.begin_patient_document_upload($1, 'ID_PROOF'::"DocumentCategory", 'RLS P63', 'rls.png', 'image/png', 10, $2)`,
            [PORTAL_PATIENT, SHA.replace(/^b/, "e")])).rows[0].document_id as string;
          await app.query(`SELECT app.complete_patient_document_upload($1)`, [idFile]);
          await pin(PORTAL_USER, CLINIC_A);
          const portalFiles = (await app.query(`SELECT id FROM patient_documents`)).rows.map((x) => x.id as string);
          record("P6.3: patient sees only the result file of their shared report (not their ID proof)", portalFiles.length === 1 && portalFiles[0] === labFile, `${portalFiles.length} visible`);
          const portalWrites = [
            await attempt(app, `INSERT INTO patient_documents (id) VALUES (gen_random_uuid())`),
            await attempt(app, `UPDATE lab_reports SET "sharedWithPatientAt" = NULL`),
            await attempt(app, `SELECT app.archive_patient_document($1, 'DUPLICATE'::"DocumentArchiveReason", NULL)`, [labFile]),
            await attempt(app, `SELECT app.set_lab_report_shared($1, false)`, [reportId]),
          ];
          record("P6.3: a patient can't write, archive or change sharing", portalWrites.every((w) => !w.ok), portalWrites.map((w) => short(w.message)).join(" | "));
          await pin(PORTAL_USER, CLINIC_B);
          const portalForged = await count(app, `SELECT (SELECT count(*) FROM lab_reports) + (SELECT count(*) FROM patient_documents) n`);
          await pin(DOCTOR_1_USER, CLINIC_A);
          await app.query(`SELECT app.set_lab_report_shared($1, false)`, [reportId]);
          await pin(PORTAL_USER, CLINIC_A);
          const afterUnshare = await count(app, `SELECT (SELECT count(*) FROM lab_reports) + (SELECT count(*) FROM patient_documents) n`);
          record("P6.3: unsharing hides the report and its files; a forged clinic context sees nothing", afterUnshare === 0 && portalForged === 0, `${afterUnshare} after unshare, ${portalForged} forged`);
        } else {
          record("P6.2: patient sees no unshared lab reports or files", portalBefore === 0, `${portalBefore} visible (shared case not tested: portal patient has no DR-01 appointment)`);
        }
      });

      await admin.query("BEGIN");
      try {
        await admin.query("SET LOCAL ROLE anon");
        const anonDocs = await attempt(admin, `SELECT count(*) FROM patient_documents`);
        await admin.query("SET LOCAL ROLE authenticated");
        const authdReports = await attempt(admin, `SELECT count(*) FROM lab_reports`);
        record("P6.2: Data API roles (anon/authenticated) are denied on documents and lab reports", !anonDocs.ok && !authdReports.ok, short(anonDocs.message));
      } finally {
        await admin.query("ROLLBACK");
      }

      // Storage posture (read-only): the bucket is private with the approved limits, storage.objects has RLS and
      // no policies (only the server's secret key can reach files), and neither the runtime role nor browser roles see objects.
      const bucket = (await admin.query(`SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'patient-documents'`)).rows[0];
      if (!bucket) {
        console.log("P6.2 storage checks skipped: the patient-documents bucket doesn't exist yet (prisma/p62-storage-setup.ts).");
      } else {
        const mimes = [...(bucket.allowed_mime_types ?? [])].sort().join(",");
        record("P6.2: bucket is private, 8 MB, PDF/JPEG/PNG only", bucket.public === false && Number(bucket.file_size_limit) === 8388608 && mimes === "application/pdf,image/jpeg,image/png", `public=${bucket.public} limit=${bucket.file_size_limit} types=${mimes}`);
        const posture = (await admin.query(`SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) AS rls,
            (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') AS policies,
            has_schema_privilege('sehat_app', 'storage', 'USAGE') AS app_usage`)).rows[0];
        record("P6.2: storage.objects has RLS and no policies; the runtime role has no storage access", posture.rls === true && posture.policies === 0 && posture.app_usage === false, JSON.stringify(posture));
        const appObjects = await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A }, () => attempt(app, `SELECT count(*) FROM storage.objects`));
        await admin.query("BEGIN");
        try {
          const counts: number[] = [];
          for (const role of ["anon", "authenticated"]) {
            await admin.query(`SET LOCAL ROLE ${role}`);
            const r = await attempt(admin, `SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'patient-documents'`);
            counts.push(r.ok ? Number((await admin.query(`SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'patient-documents'`)).rows[0].n) : 0);
          }
          record("P6.2: runtime and browser roles can't read stored files", !appObjects.ok && counts.every((c) => c === 0), `sehat_app: ${short(appObjects.message)}; anon/authenticated rows: ${counts.join("/")}`);
        } finally {
          await admin.query("ROLLBACK");
        }
      }
    }

    // --- P6.4 patient linking codes (all inside rolled-back transactions) -----------------------------
    const p64Applied = Boolean((await admin.query(`SELECT to_regprocedure('app.redeem_patient_link_code(text, text)') IS NOT NULL AS ok`)).rows[0].ok);
    if (!p64Applied) {
      console.log("P6.4 checks skipped: migration 20261022000000_patient_link_codes isn't applied.");
    } else {
      const linkPatient = (await admin.query(`SELECT id FROM patients WHERE "clinicId" = $1 AND "userId" IS NULL AND status = 'ACTIVE' ORDER BY "patientNumber" LIMIT 1`, [CLINIC_A])).rows[0]?.id as string;
      const LOGIN = "rls-p64-unlinked-login";
      await inTx(app, { user_id: ADMIN_A, clinic_id: CLINIC_A, branch_id: "", auth_user_id: "" }, async () => {
        const direct = [
          await attempt(app, `SELECT count(*) FROM patient_link_codes`),
          await attempt(app, `SELECT count(*) FROM patient_link_attempts`),
          await attempt(app, `INSERT INTO patient_link_codes (id) VALUES (gen_random_uuid())`),
          await attempt(app, `UPDATE patient_link_codes SET status = 'ACTIVE'`),
          await attempt(app, `INSERT INTO patient_link_attempts ("authUserId", succeeded) VALUES ('x', true)`),
          await attempt(app, `SELECT app.new_patient_link_code()`),
        ];
        record("P6.4: runtime role has no direct access to linking codes, attempts or the code generator", direct.every((d) => !d.ok), direct.map((d) => short(d.message)).join(" | "));

        const code = (await app.query(`SELECT code FROM app.issue_patient_link_code($1, true)`, [linkPatient])).rows[0].code as string;
        const setLogin = (user: string, clinic: string) =>
          app.query(`SELECT set_config('app.auth_user_id', $1, true), set_config('app.user_id', $2, true), set_config('app.clinic_id', $3, true), set_config('app.branch_id', '', true)`, [LOGIN, user, clinic]);
        const clinicalCount = () => count(app, `SELECT (SELECT count(*) FROM patients) + (SELECT count(*) FROM appointments) + (SELECT count(*) FROM consultations)
          + (SELECT count(*) FROM prescriptions) + (SELECT count(*) FROM invoices) + (SELECT count(*) FROM lab_reports) + (SELECT count(*) FROM patient_documents) AS n`);
        await setLogin("", CLINIC_A);
        const unlinked = await clinicalCount();
        const unlinkedIds = await count(app, `SELECT coalesce(array_length(app.current_patient_ids(), 1), 0) AS n`);
        record("P6.4: a registered but unlinked login sees no patient, clinical or billing rows", unlinked === 0 && unlinkedIds === 0, `${unlinked} rows, ${unlinkedIds} patient ids`);

        const redeemed = (await app.query(`SELECT result FROM app.redeem_patient_link_code($1, 'zztest.rls.p64@example.com')`, [code])).rows[0].result as string;
        const uid = (await app.query(`SELECT id FROM users WHERE "authProviderId" = $1`, [LOGIN])).rows[0]?.id as string | undefined;
        await setLogin(uid ?? "", CLINIC_A);
        const mine = (await app.query(`SELECT id FROM patients`)).rows.map((r) => r.id as string);
        const ids = (await app.query(`SELECT app.current_patient_ids() AS ids`)).rows[0].ids as string[];
        record("P6.4: redeeming links exactly the code's patient (RLS then shows that one record)",
          redeemed === "LINKED" && mine.length === 1 && mine[0] === linkPatient && ids.length === 1 && ids[0] === linkPatient, `${redeemed}, ${mine.length} visible`);
        const replay = (await app.query(`SELECT result FROM app.redeem_patient_link_code($1, 'zztest.rls.p64@example.com')`, [code])).rows[0].result as string;
        const patientIssues = await attempt(app, `SELECT * FROM app.issue_patient_link_code($1, true)`, [PORTAL_PATIENT]);
        const patientStatus = await attempt(app, `SELECT * FROM app.patient_portal_link_status($1)`, [linkPatient]);
        record("P6.4: the code is single-use; a linked patient can't issue codes or read link status", replay === "ALREADY_LINKED" && !patientIssues.ok && !patientStatus.ok, short(patientIssues.message));
      });

      for (const [label, ctx, allowed] of [
        ["administrator", { user_id: ADMIN_A, clinic_id: CLINIC_A, branch_id: "" }, true],
        ["clinic manager", { user_id: demoId("user:ST-02"), clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD }, false],
        ["doctor", { user_id: DOCTOR_1_USER, clinic_id: CLINIC_A, branch_id: "" }, false],
        ["other clinic's administrator", { user_id: ADMIN_B, clinic_id: CLINIC_B, branch_id: "" }, false],
      ] as const) {
        const r = await inTx(app, { ...ctx, auth_user_id: "" }, () => attempt(app, `SELECT * FROM app.issue_patient_link_code($1, true)`, [linkPatient]));
        record(`P6.4: ${label} ${allowed ? "can" : "can't"} issue a code for a clinic A patient (database-enforced)`, r.ok === allowed, short(r.message));
      }
      const receptionActive = Boolean((await admin.query(`SELECT 1 FROM clinic_memberships WHERE "userId" = $1 AND status = 'ACTIVE'`, [RECEPTION_WAKAD])).rowCount);
      if (receptionActive) {
        const r = await inTx(app, { user_id: RECEPTION_WAKAD, clinic_id: CLINIC_A, branch_id: BRANCH_A_WAKAD, auth_user_id: "" }, () => attempt(app, `SELECT * FROM app.issue_patient_link_code($1, true)`, [linkPatient]));
        record("P6.4: receptionist can issue a code", r.ok, short(r.message));
      }
      await admin.query("BEGIN");
      try {
        await admin.query("SET LOCAL ROLE anon");
        const anonCodes = await attempt(admin, `SELECT count(*) FROM patient_link_codes`);
        const anonRedeem = await attempt(admin, `SELECT * FROM app.redeem_patient_link_code('x', 'a@b.co')`);
        await admin.query("SET LOCAL ROLE authenticated");
        const authdAttempts = await attempt(admin, `SELECT count(*) FROM patient_link_attempts`);
        record("P6.4: Data API roles can't read codes/attempts or call the functions", !anonCodes.ok && !anonRedeem.ok && !authdAttempts.ok, short(anonCodes.message));
      } finally {
        await admin.query("ROLLBACK");
      }
    }

    // --- Supabase Data API roles ----------------------------------------------------------------------
    await admin.query("BEGIN");
    try {
      await admin.query("SET LOCAL ROLE anon");
      const anon = await attempt(admin, `SELECT count(*) FROM patients`);
      await admin.query("SET LOCAL ROLE authenticated");
      const authd = await attempt(admin, `SELECT count(*) FROM audit_events`);
      record("Data API roles (anon/authenticated) are denied", !anon.ok && !authd.ok, short(anon.message));
    } finally {
      await admin.query("ROLLBACK");
    }
  } finally {
    await app.end();
    await admin.end();
  }

  console.table(results);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`${failed.length} check(s) FAILED.`);
    process.exit(1);
  }
  console.log(`All ${results.length} security checks passed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
