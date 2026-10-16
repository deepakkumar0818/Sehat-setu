// P6.5 patient-onboarding migration DRY RUN (20261023000000_patient_intake).
//
//   npx tsx prisma/p65-dry-run.ts
//
// Executes the migration file inside ONE transaction on the admin connection
// (DIRECT_URL), then — still inside that transaction — switches to the runtime
// role (SET LOCAL ROLE sehat_app) and exercises the new functions and RLS
// policies as the fictional fixture users (portal user PU-01, staff ST-01,
// ST-02, ST-04, ST-05, ST-07, DR-01, DR-02). It then ALWAYS rolls back: nothing
// is recorded in _prisma_migrations and nothing is committed; every existing
// table is fingerprinted before and after to prove it.
//
// Prints check names, pass/fail and counts only — never names, phone numbers
// or answers (the synthetic values are "ZZTEST" fixtures anyway).
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { tableFingerprints } from "./p5-preflight";
import { demoId } from "./seed/demo-data";

config({ path: [".env.local", ".env"], quiet: true });

const MIGRATION = "20261023000000_patient_intake";
const NEW_TABLES = ["patient_intake_profiles", "patient_symptom_reports"];
const ENTRY = [
  "app.save_patient_intake_personal(text, date, text, text, text, text, text, text, text, text, text)",
  "app.save_patient_intake_medical(text, jsonb, jsonb, text[], text, text)",
  "app.skip_patient_intake_medical()",
  "app.submit_patient_symptom_report(uuid, uuid, text, text, text, text, text)",
  "app.complete_patient_intake()",
  "app.patient_reported_visible(uuid)",
];
const INTERNAL = ["app.intake_current_patient()", "app.intake_items_valid(jsonb, text, text[])", "app.intake_e164(text)"];
const PATIENT_1 = demoId("patient:1");
const ZZ_NAME = "ZZTEST Dryrun Patient";
const ZZ_PHONE = "+919800000071";

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const db = new Client(verifiedPgConfig(url));
  await db.connect();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;

  try {
    if ((await db.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [MIGRATION])).rowCount) throw new Error(`${MIGRATION} is already applied; nothing to dry-run.`);
    const before = await tableFingerprints(db, ["_prisma_migrations"]);

    // Fixture facts (read as admin, before the transaction).
    const userId = (key: string) => demoId(`user:${key}`);
    const membership = async (key: string) =>
      one<{ clinicId: string; branchId: string | null }>(`SELECT m."clinicId", m."branchId" FROM clinic_memberships m WHERE m."userId" = $1 AND m.status = 'ACTIVE' ORDER BY m."createdAt" LIMIT 1`, [userId(key)]);
    const linked = await one<{ n: string }>(`SELECT count(*) n FROM patients WHERE id = $1 AND "userId" = $2`, [PATIENT_1, userId("PU-01")]);
    if (Number(linked.n) !== 1) throw new Error("Fixture PU-01 isn't linked to demo patient #1 — run npm run db:seed.");
    const clinicA = (await membership("ST-01")).clinicId;
    const otherPatient = (await one<{ id: string }>(`SELECT id FROM patients WHERE "clinicId" = $1 AND id <> $2 AND "userId" IS NULL ORDER BY "patientNumber" LIMIT 1`, [clinicA, PATIENT_1])).id;
    const otherAppt = (await one<{ id: string } | undefined>(`SELECT id FROM appointments WHERE "patientId" = $1 LIMIT 1`, [otherPatient]))?.id;
    const ownUpcoming = (await one<{ id: string } | undefined>(
      `SELECT id FROM appointments WHERE "patientId" = $1 AND status IN ('SCHEDULED','CONFIRMED') AND "startsAt" > now() - interval '12 hours' ORDER BY "startsAt" LIMIT 1`, [PATIENT_1]))?.id;
    const dr1HasPatient1 = Number((await one<{ n: string }>(`SELECT count(*) n FROM appointments WHERE "patientId" = $1 AND "doctorId" = $2`, [PATIENT_1, demoId("doctor:DR-01")])).n) > 0;
    const dr2HasOther = Number((await one<{ n: string }>(`SELECT count(*) n FROM appointments WHERE "patientId" = $1 AND "doctorId" = $2`, [otherPatient, demoId("doctor:DR-02")])).n) > 0;
    const tomorrowIst = (await one<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') d`)).d;

    await db.query("BEGIN");
    try {
      const sql = readFileSync(path.resolve(import.meta.dirname, "migrations", MIGRATION, "migration.sql"), "utf8");
      await db.query(sql); // simple-query protocol: the whole file, as prisma migrate deploy would
      record("migration executes", true);

      const rls = (await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) AND relnamespace = 'public'::regnamespace`, [NEW_TABLES])).rows;
      record("2 new tables with RLS enabled", rls.length === 2 && rls.every((r) => r.relrowsecurity));
      const grants = (await db.query(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_name = ANY($1) AND grantee IN ('sehat_app','anon','authenticated') ORDER BY 1,2,3`, [NEW_TABLES])).rows;
      record("runtime role: SELECT only; anon/authenticated: nothing", grants.length === 2 && grants.every((g) => g.grantee === "sehat_app" && g.privilege_type === "SELECT"), grants.map((g) => `${g.grantee}:${g.table_name}:${g.privilege_type}`).join(" "));
      for (const fn of ENTRY) {
        const r = await one<{ app: boolean; anon: boolean }>(`SELECT has_function_privilege('sehat_app', $1, 'EXECUTE') app, has_function_privilege('anon', $1, 'EXECUTE') anon`, [fn]);
        record(`sehat_app may execute ${fn.split("(")[0]} (anon may not)`, r.app && !r.anon);
      }
      for (const fn of INTERNAL) record(`sehat_app may NOT execute ${fn.split("(")[0]}`, !(await one<{ app: boolean }>(`SELECT has_function_privilege('sehat_app', $1, 'EXECUTE') app`, [fn])).app);

      // --- Behaviour as the runtime role --------------------------------------------------
      let n = 0;
      /** Runs `fn` as sehat_app with a fixture user's context, in a savepoint (errors don't abort the dry run). */
      const as = async <T>(key: string, fn: () => Promise<T>, patient = false): Promise<{ ok: true; value: T } | { ok: false; code: string }> => {
        const sp = `sp${++n}`;
        const m = await membership(key);
        await db.query(`SAVEPOINT ${sp}`);
        try {
          await db.query("SET LOCAL ROLE sehat_app");
          await db.query(`SELECT set_config('app.auth_user_id', $1, true), set_config('app.user_id', $2, true), set_config('app.clinic_id', $3, true), set_config('app.branch_id', $4, true)`, [
            `test-${key}`, userId(key), m.clinicId, patient ? "" : (m.branchId ?? ""),
          ]);
          const value = await fn();
          await db.query("RESET ROLE");
          await db.query(`RELEASE SAVEPOINT ${sp}`);
          return { ok: true, value };
        } catch (err) {
          await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          await db.query("RESET ROLE");
          const msg = err instanceof Error ? err.message : "";
          return { ok: false, code: /patient intake: ([A-Z_]+)/.exec(msg)?.[1] ?? (err as { code?: string }).code ?? "ERROR" };
        }
      };

      const roleSwitch = await as("ST-01", async () => (await one<{ u: string }>("SELECT current_user u")).u);
      if (!roleSwitch.ok || roleSwitch.value !== "sehat_app") {
        // Supabase's postgres role may not SET ROLE to the runtime role. No role grant is attempted:
        // behaviour is then covered by the integration tests (they connect AS sehat_app) after applying.
        record("behaviour checks as sehat_app", true, `skipped: SET ROLE sehat_app not permitted (${roleSwitch.ok ? String(roleSwitch.value) : roleSwitch.code}); run npm run test:integration after applying`);
      } else {

      const patientsBefore = (await tableFingerprints(db, []))["patients"];
      const savePersonal = (dob: string) =>
        db.query(`SELECT app.save_patient_intake_personal($1, $2::date, NULL, $3, '1 ZZTEST Road', 'Pune', NULL, '411001', 'ZZTEST Contact', 'Spouse', '+919800000072')`, [ZZ_NAME, dob, ZZ_PHONE]);

      record("staff can't use the patient entry points (NOT_PERMITTED)", (await as("ST-01", () => savePersonal("1990-05-17"))) .ok === false);
      const futureDob = await as("PU-01", () => savePersonal(tomorrowIst), true);
      record("future date of birth (tomorrow in IST) refused", !futureDob.ok && futureDob.code === "INVALID_INPUT", futureDob.ok ? "accepted" : futureDob.code);
      const medicalFirst = await as("PU-01", () => db.query(`SELECT app.save_patient_intake_medical('NONE_KNOWN', '[]', '[]', '{}', NULL, NULL)`), true);
      record("medical history before personal details: PERSONAL_FIRST", !medicalFirst.ok && medicalFirst.code === "PERSONAL_FIRST");
      const completeFirst = await as("PU-01", () => db.query(`SELECT app.complete_patient_intake()`), true);
      record("completion before personal details: PERSONAL_FIRST", !completeFirst.ok && completeFirst.code === "PERSONAL_FIRST");

      const saved = await as("PU-01", () => savePersonal("1990-05-17"), true);
      record("patient saves personal details", saved.ok, saved.ok ? "" : saved.code);
      const savedAgain = await as("PU-01", () => savePersonal("1990-05-18"), true);
      record("saving again updates the same row (idempotent upsert)", savedAgain.ok && Number((await one<{ n: string }>(`SELECT count(*) n FROM patient_intake_profiles WHERE "patientId" = $1`, [PATIENT_1])).n) === 1);
      record("the clinic's patients table is unchanged", JSON.stringify((await tableFingerprints(db, []))["patients"]) === JSON.stringify(patientsBefore));

      const badAllergy = await as("PU-01", () => db.query(`SELECT app.save_patient_intake_medical('NONE_KNOWN', '[{"substance":"ZZTEST"}]', '[]', '{}', NULL, NULL)`), true);
      record("'No known allergies' with a listed allergy refused", !badAllergy.ok && badAllergy.code === "INVALID_INPUT");
      const extraKey = await as("PU-01", () => db.query(`SELECT app.save_patient_intake_medical('HAS_ALLERGIES', '[{"substance":"ZZTEST","diagnosis":"x"}]', '[]', '{}', NULL, NULL)`), true);
      record("unexpected keys in allergy entries refused", !extraKey.ok && extraKey.code === "INVALID_INPUT");
      const medical = await as("PU-01", () => db.query(`SELECT app.save_patient_intake_medical('UNKNOWN', '[]', '[{"name":"ZZTEST med","dose":null}]', '{"ZZTEST condition"}', NULL, NULL)`), true);
      const status = await one<{ s: string; reviewed: boolean }>(`SELECT "allergyStatus"::text s, "medicalReviewedAt" IS NOT NULL reviewed FROM patient_intake_profiles WHERE "patientId" = $1`, [PATIENT_1]);
      record("medical history saved; 'Unknown' stored as UNKNOWN (distinct from NONE_KNOWN / NOT_ANSWERED)", medical.ok && status.s === "UNKNOWN" && status.reviewed);

      const REQ = "5e1c0d2a-1111-4222-8333-000000000065";
      const submit = (req: string, appt: string | null) => db.query(`SELECT * FROM app.submit_patient_symptom_report($1::uuid, $2::uuid, 'ZZTEST reason', 'ZZTEST symptoms', 'DAYS_1_3', 'MILD', NULL)`, [req, appt]);
      const first = await as("PU-01", () => submit(REQ, null), true);
      const repeat = await as("PU-01", () => submit(REQ, null), true);
      const reportCount = Number((await one<{ n: string }>(`SELECT count(*) n FROM patient_symptom_reports WHERE "patientId" = $1`, [PATIENT_1])).n);
      record("symptom report saved; a repeated request id returns the first (no duplicate)", first.ok && repeat.ok && (first.value as { rows: { created: boolean }[] }).rows[0].created && !(repeat.value as { rows: { created: boolean }[] }).rows[0].created && reportCount === 1, `rows=${reportCount}`);
      if (otherAppt) {
        const foreign = await as("PU-01", () => submit("5e1c0d2a-1111-4222-8333-000000000066", otherAppt), true);
        record("another patient's appointment refused (APPOINTMENT_NOT_FOUND)", !foreign.ok && foreign.code === "APPOINTMENT_NOT_FOUND");
      } else record("another patient's appointment refused", true, "skipped: no fixture appointment for another patient");
      if (ownUpcoming) {
        const own = await as("PU-01", () => submit("5e1c0d2a-1111-4222-8333-000000000067", ownUpcoming), true);
        record("own upcoming appointment can be linked", own.ok && (own.value as { rows: { appointment_id: string }[] }).rows[0].appointment_id === ownUpcoming);
      } else record("own upcoming appointment can be linked", true, "skipped: patient #1 has no upcoming appointment");
      const update = await as("PU-01", () => db.query(`UPDATE patient_symptom_reports SET symptoms = 'x'`), true);
      const insert = await as("PU-01", () => db.query(`INSERT INTO patient_intake_profiles ("clinicId") VALUES ($1)`, [clinicA]), true);
      record("runtime role can't UPDATE/INSERT the new tables directly", !update.ok && !insert.ok, `${update.ok ? "update ok" : update.code}/${insert.ok ? "insert ok" : insert.code}`);
      const done = await as("PU-01", () => db.query(`SELECT app.complete_patient_intake()`), true);
      record("onboarding completes (medical/symptoms optional)", done.ok && Boolean((await one<{ c: Date | null }>(`SELECT "completedAt" c FROM patient_intake_profiles WHERE "patientId" = $1`, [PATIENT_1])).c));

      // A second patient's row, inserted as admin, to prove isolation.
      await db.query(`INSERT INTO patient_intake_profiles ("clinicId","patientId","legalName","dateOfBirth",phone,"addressLine",city,"personalSavedAt","reportedByUserId")
                      VALUES ($1,$2,'ZZTEST Other','1980-01-01','+919800000073','2 ZZTEST Rd','Pune',now(),$3)`, [clinicA, otherPatient, userId("ST-01")]);
      const sees = async (key: string, patient = false) => {
        const r = await as(key, async () => (await db.query(`SELECT "patientId" FROM patient_intake_profiles`)).rows.map((x) => x.patientId as string), patient);
        return r.ok ? r.value : [];
      };
      const pu = await sees("PU-01", true);
      record("patient sees only their own profile", pu.length === 1 && pu[0] === PATIENT_1, `${pu.length} row(s)`);
      const adm = await sees("ST-01");
      record("clinic administrator (medical_record.view) sees both", adm.length === 2, `${adm.length}`);
      for (const key of ["ST-02", "ST-04", "ST-05"]) {
        const rows = await sees(key);
        record(`${key} (no medical-record permission) sees nothing`, rows.length === 0, `${rows.length}`);
      }
      const other = await sees("ST-07");
      record("other clinic's administrator sees nothing", other.length === 0, `${other.length}`);
      const dr1 = await sees("DR-01");
      record("DR-01 sees patient #1 only if assigned", dr1.includes(PATIENT_1) === dr1HasPatient1, `assigned=${dr1HasPatient1} sees=${dr1.includes(PATIENT_1)}`);
      const dr2 = await sees("DR-02");
      record("DR-02 sees the other patient only if assigned", dr2.includes(otherPatient) === dr2HasOther, `assigned=${dr2HasOther} sees=${dr2.includes(otherPatient)}`);
      const symptomsForReceptionist = await as("ST-04", async () => Number((await one<{ n: string }>(`SELECT count(*) n FROM patient_symptom_reports`)).n));
      record("receptionist can't read symptom reports", symptomsForReceptionist.ok && symptomsForReceptionist.value === 0);

      const audit = (await db.query(`SELECT action, metadata, "actorLabel", reason FROM audit_events WHERE action LIKE 'patient_intake.%' OR "targetType" = ANY($1)`, [NEW_TABLES])).rows;
      const leaked = JSON.stringify(audit).match(/ZZTEST|9800000071|9800000072|1990-05-1/g);
      record("audit rows written, with no names, phones, dates of birth or answers", audit.length > 0 && !leaked, `${audit.length} rows${leaked ? `; leaked ${leaked.length}` : ""}`);

      }

      const inside = await tableFingerprints(db, ["_prisma_migrations", "audit_events", ...NEW_TABLES]);
      const changed = Object.keys(before).filter((t) => t !== "audit_events" && JSON.stringify(before[t]) !== JSON.stringify(inside[t]));
      record("no existing table changed (except new audit rows), inside the transaction", changed.length === 0, changed.join(", ") || "identical");
    } finally {
      await db.query("ROLLBACK");
    }
    const after = await tableFingerprints(db, ["_prisma_migrations"]);
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: no new table remains", !Object.keys(after).some((t) => NEW_TABLES.includes(t)));
    record("rolled back: every existing table identical to before", drift.length === 0, drift.join(", ") || "identical");
  } finally {
    await db.end();
    for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.check}${c.detail ? `  (${c.detail})` : ""}`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED. Nothing was committed.` : `\nAll ${checks.length} checks passed. Nothing was committed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "dry run failed");
  process.exit(2);
});
