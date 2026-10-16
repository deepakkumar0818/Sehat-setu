// DRY RUN of 20261021000000_patient_documents — run only with explicit approval.
//
//   npx tsx prisma/p62-dry-run.ts
//
// Executes the migration inside ONE transaction on the admin connection
// (DIRECT_URL), exercises the new functions as fixture users (pinned session
// settings, exactly as the app pins them), then ALWAYS rolls back: nothing is
// committed or recorded in _prisma_migrations, and no file is stored anywhere
// (this script never talks to Supabase Storage). Every table is re-read
// afterwards to prove nothing changed. No titles, filenames or values are printed.
//
// Limitation: the admin role can't SET ROLE sehat_app, so the new RLS
// POLICIES (as enforced for the runtime role) are checked here only by their
// definitions and by evaluating the visibility helpers they call; the policies
// themselves are exercised by `npm run db:verify-rls` after an approved apply.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { verifiedPgConfig } from "../src/server/db/tls";
import { demoId } from "./seed/demo-data";
import { tableFingerprints } from "./p5-preflight";

config({ path: [".env.local", ".env"], quiet: true });

const NAME = "20261021000000_patient_documents";
const SHA = "a".repeat(64);
const ENTRY_POINTS = [
  'app.begin_patient_document_upload(uuid, "DocumentCategory", text, text, text, integer, text, uuid, uuid, uuid)',
  "app.complete_patient_document_upload(uuid)",
  "app.fail_patient_document_upload(uuid, text)",
  'app.archive_patient_document(uuid, "DocumentArchiveReason", text)',
  "app.create_lab_report(uuid, text, text, uuid, uuid)",
  "app.set_lab_report_values(uuid, jsonb, date, text)",
  "app.review_lab_report(uuid)",
  "app.set_lab_report_shared(uuid, boolean)",
];
const POLICY_HELPERS = ['app.document_is_clinical("DocumentCategory")', "app.clinical_record_visible(uuid, uuid)", "app.admin_document_visible(uuid)"];
const INTERNAL = ["app.require_document_staff()", "app.document_patient_in_scope(uuid)", "app.document_branch(uuid, uuid)", "app.document_rate_limit()", "app.lab_report_doctor_may_sign(lab_reports)"];

async function main() {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL must be set in .env.local.");
  const c = new Client(verifiedPgConfig(url));
  await c.connect();
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const record = (check: string, ok: boolean, detail = "") => checks.push({ check, ok, detail });
  /** Runs one statement in a savepoint; returns its rows, or the error message. */
  const attempt = async (sql: string, params: unknown[] = []): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; msg: string }> => {
    await c.query("SAVEPOINT dry");
    try {
      const res = await c.query(sql, params);
      await c.query("RELEASE SAVEPOINT dry");
      return { ok: true, rows: res.rows };
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT dry");
      return { ok: false, msg: (e as Error).message };
    }
  };
  const msg = (r: Awaited<ReturnType<typeof attempt>>) => (r.ok ? "OK" : r.msg);
  const pin = (userKey: string, clinicKey: string, branchKey = "") =>
    c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.branch_id', $3, true), set_config('app.auth_user_id', '', true)`,
      [userKey ? demoId(`user:${userKey}`) : "", demoId(`clinic:${clinicKey}`), branchKey ? demoId(`branch:${branchKey}`) : ""]);
  const begin = (patientId: string, category: string, extra: { branch?: string; mime?: string; size?: number; sha?: string; name?: string; labReportId?: string } = {}) =>
    attempt(`SELECT * FROM app.begin_patient_document_upload($1, $2::"DocumentCategory", 'ZZTEST title', $3, $4, $5, $6, $7, $8)`,
      [patientId, category, extra.name ?? "zztest.pdf", extra.mime ?? "application/pdf", extra.size ?? 1234, extra.sha ?? SHA, extra.branch ? demoId(`branch:${extra.branch}`) : null, extra.labReportId ?? null]);

  try {
    if ((await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount) throw new Error(`${NAME} is already applied; nothing to dry-run.`);
    const before = await tableFingerprints(c, ["_prisma_migrations"]);
    const clinicA = demoId("clinic:AAR");
    const doctor1 = demoId("doctor:DR-01");
    // A clinic-A patient with an appointment with DR-01, one without, and the nurse fixture's status.
    const assigned = (await c.query(`SELECT a."patientId" AS id FROM appointments a WHERE a."doctorId" = $1 ORDER BY a."startsAt" LIMIT 1`, [doctor1])).rows[0]?.id as string;
    const unassigned = (await c.query(`SELECT p.id FROM patients p WHERE p."clinicId" = $1 AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a."patientId" = p.id AND a."doctorId" = $2) ORDER BY p."patientNumber" LIMIT 1`, [clinicA, doctor1])).rows[0]?.id as string;
    const patientB = (await c.query(`SELECT p.id FROM patients p WHERE p."clinicId" = $1 ORDER BY p."patientNumber" LIMIT 1`, [demoId("clinic:NIR")])).rows[0]?.id as string;
    if (!assigned || !unassigned || !patientB) throw new Error("fixture patients not found (expected seed data)");
    const nurseActive = Boolean((await c.query(`SELECT 1 FROM clinic_memberships m WHERE m."userId" = $1 AND m.status = 'ACTIVE'`, [demoId("user:ST-05")])).rowCount);
    const permsBefore = (await c.query(`SELECT key, name, module, description FROM permissions ORDER BY key`)).rows;

    await c.query("BEGIN");
    try {
      await c.query(readFileSync(path.resolve(import.meta.dirname, "migrations", NAME, "migration.sql"), "utf8"));
      record(`${NAME} executes`, true);

      // --- structure ---------------------------------------------------------------
      const t = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('lab_reports', 'patient_documents') AND relnamespace = 'public'::regnamespace ORDER BY 1`)).rows;
      record("tables created with RLS enabled", t.length === 2 && t.every((r) => r.relrowsecurity), JSON.stringify(t));
      const grants = (await c.query(`SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants
                                     WHERE table_schema = 'public' AND table_name IN ('lab_reports', 'patient_documents') AND grantee IN ('sehat_app', 'anon', 'authenticated') GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
      record("runtime role: SELECT only; anon/authenticated: nothing", JSON.stringify(grants) === JSON.stringify([{ grantee: "sehat_app", table_name: "lab_reports", p: "SELECT" }, { grantee: "sehat_app", table_name: "patient_documents", p: "SELECT" }]), JSON.stringify(grants));
      const pol = (await c.query(`SELECT tablename, policyname, cmd, roles::text r FROM pg_policies WHERE tablename IN ('lab_reports', 'patient_documents') ORDER BY 1`)).rows;
      record("one SELECT policy per table, TO sehat_app", pol.length === 2 && pol.every((p) => p.cmd === "SELECT" && p.r === "{sehat_app}"), pol.map((p) => p.policyname).join(","));
      const fns = (await c.query(`SELECT f AS sig, p.prosecdef AS secdef, p.proconfig = ARRAY['search_path=""'] AS sp,
                                         has_function_privilege('sehat_app', p.oid, 'EXECUTE') AS app, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                                         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd
                                    FROM unnest($1::text[]) f JOIN pg_proc p ON p.oid = to_regprocedure(f)`, [[...ENTRY_POINTS, ...POLICY_HELPERS, ...INTERNAL]])).rows;
      const by = (s: string) => fns.find((f) => f.sig === s);
      record("every function exists with search_path=''", fns.length === ENTRY_POINTS.length + POLICY_HELPERS.length + INTERNAL.length && fns.every((f) => f.sp), `${fns.length} found`);
      record("entry points: SECURITY DEFINER, EXECUTE sehat_app only", ENTRY_POINTS.every((s) => by(s)?.secdef && by(s)?.app && !by(s)?.anon && !by(s)?.authd));
      record("policy helpers: executable by sehat_app only", POLICY_HELPERS.every((s) => by(s)?.app && !by(s)?.anon && !by(s)?.authd));
      record("internal helpers: not executable by sehat_app", INTERNAL.every((s) => by(s) && !by(s)?.app && !by(s)?.anon));

      // --- permissions ------------------------------------------------------------
      const holders = Object.fromEntries((await c.query(`SELECT p.key, coalesce(string_agg(r.key::text, ',' ORDER BY r.key::text), '') roles FROM permissions p
          LEFT JOIN role_permissions rp ON rp."permissionId" = p.id LEFT JOIN roles r ON r.id = rp."roleId"
          WHERE p.key IN ('patient_document.upload', 'patient_document.view', 'patient_document.manage', 'lab_report.upload', 'lab_result.update', 'lab_report.view') GROUP BY p.key`)).rows.map((r) => [r.key, r.roles]));
      record("grants match the agreed matrix", JSON.stringify(holders) === JSON.stringify({
        "lab_report.upload": "ADMINISTRATOR,DOCTOR,NURSE,RECEPTIONIST", "lab_report.view": "DOCTOR,NURSE,PATIENT", "lab_result.update": "DOCTOR,NURSE",
        "patient_document.manage": "ADMINISTRATOR,CLINIC_MANAGER", "patient_document.upload": "ADMINISTRATOR,CLINIC_MANAGER,RECEPTIONIST", "patient_document.view": "ADMINISTRATOR,CLINIC_MANAGER,RECEPTIONIST",
      }), JSON.stringify(holders));
      const permsAfter = (await c.query(`SELECT key, name, module, description FROM permissions WHERE key NOT LIKE 'patient_document.%' ORDER BY key`)).rows;
      record("existing permission rows unchanged", JSON.stringify(permsAfter) === JSON.stringify(permsBefore), `${permsBefore.length} rows`);

      // --- uploads ----------------------------------------------------------------
      const seen = (await c.query(`SELECT id FROM audit_events`)).rows.map((r) => r.id);
      await pin("ST-04", "AAR", "AAR-WKD"); // receptionist, Wakad
      const recClinical = await begin(unassigned, "LAB_REPORT");
      const recDoc = recClinical.ok ? (recClinical.rows[0] as { document_id: string; storage_key: string }) : null;
      record("receptionist registers a clinical upload; key = clinicId/id", recDoc !== null && recDoc.storage_key === `${clinicA}/${recDoc.document_id}`, msg(recClinical));
      record("receptionist: another branch refused (INVALID_BRANCH)", /patient document: INVALID_BRANCH/.test(msg(await begin(unassigned, "LAB_REPORT", { branch: "AAR-KTH" }))));
      for (const [label, extra] of [["an executable type", { mime: "application/x-msdownload" }], ["9 MB", { size: 9 * 1024 * 1024 }], ["a path in the filename", { name: "../x.pdf" }], ["a bad checksum", { sha: "xyz" }]] as const) {
        record(`invalid file refused: ${label}`, /patient document: INVALID_FILE/.test(msg(await begin(unassigned, "ID_PROOF", extra))));
      }
      const branchOf = async (id: string) => (await c.query(`SELECT "branchId" FROM patient_documents WHERE id = $1`, [id])).rows[0]?.branchId;
      record("branch of a branch-limited uploader's file = their branch", recDoc !== null && (await branchOf(recDoc.document_id)) === demoId("branch:AAR-WKD"));

      await pin("ST-02", "AAR", "AAR-WKD"); // clinic manager, Wakad
      record("clinic manager: clinical upload refused", /patient document: NOT_PERMITTED/.test(msg(await begin(unassigned, "IMAGING"))));
      const mgrAdmin = await begin(unassigned, "ID_PROOF");
      record("clinic manager: administrative upload allowed", mgrAdmin.ok, msg(mgrAdmin));

      await pin("DR-01", "AAR");
      record("doctor: patient without an appointment is NOT_FOUND", /patient document: NOT_FOUND/.test(msg(await begin(unassigned, "LAB_REPORT"))));
      const drUp = await begin(assigned, "IMAGING", { branch: "AAR-KTH" });
      const drDoc = drUp.ok ? (drUp.rows[0] as { document_id: string }).document_id : null;
      record("doctor: own patient's clinical upload allowed", drDoc !== null, msg(drUp));
      record("doctor: administrative upload refused", /patient document: NOT_PERMITTED/.test(msg(await begin(assigned, "ID_PROOF"))));

      await pin("ST-07", "NIR"); // administrator of the other clinic
      record("other clinic's administrator: NOT_FOUND", /patient document: NOT_FOUND/.test(msg(await begin(unassigned, "ID_PROOF"))));

      // Complete / fail.
      await pin("ST-01", "AAR");
      record("complete by someone other than the uploader: NOT_FOUND", recDoc !== null && /patient document: NOT_FOUND/.test(msg(await attempt(`SELECT app.complete_patient_document_upload($1)`, [recDoc.document_id]))));
      await pin("ST-04", "AAR", "AAR-WKD");
      const done = recDoc ? await attempt(`SELECT app.complete_patient_document_upload($1)`, [recDoc.document_id]) : { ok: false as const, msg: "no upload" };
      const status = async (id: string) => (await c.query(`SELECT status::text FROM patient_documents WHERE id = $1`, [id])).rows[0]?.status;
      record("uploader completes: AVAILABLE", done.ok && (await status(recDoc!.document_id)) === "AVAILABLE", msg(done));
      record("complete twice: INVALID_TRANSITION", recDoc !== null && /patient document: INVALID_TRANSITION/.test(msg(await attempt(`SELECT app.complete_patient_document_upload($1)`, [recDoc.document_id]))));
      await pin("DR-01", "AAR");
      if (drDoc) await attempt(`SELECT app.fail_patient_document_upload($1, 'storage_error')`, [drDoc]);
      record("failed upload kept as FAILED", drDoc !== null && (await status(drDoc)) === "FAILED");
      const drUp2 = await begin(assigned, "IMAGING", { branch: "AAR-KTH" });
      const drDoc2 = drUp2.ok ? (drUp2.rows[0] as { document_id: string }).document_id : null;
      if (drDoc2) await attempt(`SELECT app.complete_patient_document_upload($1)`, [drDoc2]);

      // --- visibility helpers (what the RLS policies call) ------------------------------
      const vis = async (patientId: string, branchKey: string) => (await c.query(`SELECT app.clinical_record_visible($1, $2) v`, [patientId, demoId(`branch:${branchKey}`)])).rows[0].v as boolean;
      const adminVis = async (branchKey: string) => (await c.query(`SELECT app.admin_document_visible($1) v`, [demoId(`branch:${branchKey}`)])).rows[0].v as boolean;
      await pin("ST-04", "AAR", "AAR-WKD");
      record("receptionist: clinical records NOT visible (upload-only)", !(await vis(unassigned, "AAR-WKD")));
      record("receptionist: own-branch administrative visible, other branch not", (await adminVis("AAR-WKD")) && !(await adminVis("AAR-KTH")));
      await pin("ST-02", "AAR", "AAR-WKD");
      record("clinic manager: clinical NOT visible; administrative own branch only", !(await vis(unassigned, "AAR-WKD")) && (await adminVis("AAR-WKD")) && !(await adminVis("AAR-KTH")));
      await pin("DR-01", "AAR");
      record("doctor: own patient visible in BOTH branches; other patient not", (await vis(assigned, "AAR-KTH")) && (await vis(assigned, "AAR-WKD")) && !(await vis(unassigned, "AAR-KTH")));
      record("doctor: administrative documents not visible", !(await adminVis("AAR-KTH")));
      await pin("ST-01", "AAR");
      record("administrator: clinical and administrative visible in every branch", (await vis(unassigned, "AAR-KTH")) && (await vis(unassigned, "AAR-WKD")) && (await adminVis("AAR-KTH")));
      await pin("ST-07", "NIR");
      record("other clinic's administrator: nothing visible", !(await vis(assigned, "AAR-KTH")) && !(await adminVis("AAR-KTH")));
      // Regression (helpers must check the clinic themselves, not rely on the calling policy): each id is checked separately.
      record("regression: other clinic's patient with the caller's own branch NOT visible", !(await vis(assigned, "NIR-IND")));
      record("regression: caller's own patient with another clinic's branch NOT visible", !(await vis(patientB, "AAR-KTH")) && !(await vis(patientB, "AAR-WKD")));
      record("regression: same-clinic access still works (clinic B admin, clinic B ids)", (await vis(patientB, "NIR-IND")) && (await adminVis("NIR-IND")));
      await pin("ST-01", "AAR");
      record("regression: clinic A admin — clinic B patient/branch NOT visible, own still visible",
        !(await vis(patientB, "AAR-KTH")) && !(await vis(assigned, "NIR-IND")) && !(await adminVis("NIR-IND")) && (await vis(assigned, "AAR-KTH")));
      await pin("DR-01", "AAR");
      record("regression: doctor — own patient with another clinic's branch NOT visible", !(await vis(assigned, "NIR-IND")) && (await vis(assigned, "AAR-KTH")));
      await pin("", "AAR");
      record("no user pinned: nothing visible", !(await vis(assigned, "AAR-KTH")) && !(await adminVis("AAR-KTH")));
      if (nurseActive) {
        await pin("ST-05", "AAR", "AAR-KTH");
        record("nurse (Kothrud): clinical own branch only; no administrative", (await vis(unassigned, "AAR-KTH")) && !(await vis(unassigned, "AAR-WKD")) && !(await adminVis("AAR-KTH")));
      } else {
        record("nurse checks SKIPPED: fixture ST-05 is not active (not a failure)", true);
      }

      // --- archive ------------------------------------------------------------------
      const arch = (id: string, reason = "UPLOADED_IN_ERROR", note: string | null = "ZZTEST private note") =>
        attempt(`SELECT app.archive_patient_document($1, $2::"DocumentArchiveReason", $3)`, [id, reason, note]);
      await pin("ST-04", "AAR", "AAR-WKD");
      record("receptionist can't archive", recDoc !== null && /patient document: NOT_PERMITTED/.test(msg(await arch(recDoc.document_id))));
      await pin("ST-02", "AAR", "AAR-WKD");
      record("clinic manager can't archive a clinical file", recDoc !== null && /patient document: NOT_PERMITTED/.test(msg(await arch(recDoc.document_id))));
      const mgrDoc = mgrAdmin.ok ? (mgrAdmin.rows[0] as { document_id: string }).document_id : null;
      if (mgrDoc) await attempt(`SELECT app.complete_patient_document_upload($1)`, [mgrDoc]);
      record("clinic manager archives an administrative file", mgrDoc !== null && msg(await arch(mgrDoc, "DUPLICATE")) === "OK" && (await status(mgrDoc)) === "ARCHIVED");
      await pin("DR-01", "AAR");
      record("doctor archives own recent upload", drDoc2 !== null && msg(await arch(drDoc2)) === "OK" && (await status(drDoc2)) === "ARCHIVED");
      await pin("ST-01", "AAR");
      record("administrator archives a clinical file", recDoc !== null && msg(await arch(recDoc.document_id, "ILLEGIBLE")) === "OK");

      // --- lab reports ----------------------------------------------------------------
      await pin("ST-04", "AAR", "AAR-WKD");
      const lr = await attempt(`SELECT app.create_lab_report($1, 'ZZTEST test', 'ZZTEST report') id`, [assigned]);
      const reportId = lr.ok ? (lr.rows[0].id as string) : null;
      record("receptionist creates a lab report (upload-only)", reportId !== null, msg(lr));
      const values = JSON.stringify([{ parameter: "ZZTEST param", value: "1.0", unit: "u", range: "0-2", flag: "normal" }]);
      record("receptionist can't enter values", reportId !== null && /lab report: (NOT_PERMITTED|NOT_FOUND)/.test(msg(await attempt(`SELECT app.set_lab_report_values($1, $2::jsonb)`, [reportId, values]))));
      await pin("DR-01", "AAR");
      for (const [label, bad] of [["unknown key", [{ parameter: "x", dose: "1" }]], ["long text", [{ parameter: "x".repeat(121) }]], ["bad flag", [{ parameter: "x", flag: "critical" }]], ["101 items", Array.from({ length: 101 }, () => ({ parameter: "x" }))]] as const) {
        record(`invalid values refused: ${label}`, reportId !== null && /lab report: INVALID_INPUT/.test(msg(await attempt(`SELECT app.set_lab_report_values($1, $2::jsonb)`, [reportId, JSON.stringify(bad)]))));
      }
      record("doctor enters values for own patient", reportId !== null && msg(await attempt(`SELECT app.set_lab_report_values($1, $2::jsonb, NULL, 'ZZTEST note')`, [reportId, values])) === "OK");
      record("share before review: NOT_REVIEWED", reportId !== null && /lab report: NOT_REVIEWED/.test(msg(await attempt(`SELECT app.set_lab_report_shared($1, true)`, [reportId]))));
      if (nurseActive) {
        await pin("ST-05", "AAR", "AAR-KTH");
        record("nurse can't review", reportId !== null && /lab report: (NOT_PERMITTED|NOT_FOUND)/.test(msg(await attempt(`SELECT app.review_lab_report($1)`, [reportId]))));
      }
      await pin("DR-01", "AAR");
      record("assigned doctor reviews", reportId !== null && msg(await attempt(`SELECT app.review_lab_report($1)`, [reportId])) === "OK");
      record("assigned doctor shares a reviewed report", reportId !== null && msg(await attempt(`SELECT app.set_lab_report_shared($1, true)`, [reportId])) === "OK");
      record("values locked while shared (SHARED_LOCKED)", reportId !== null && /lab report: SHARED_LOCKED/.test(msg(await attempt(`SELECT app.set_lab_report_values($1, $2::jsonb)`, [reportId, values]))));
      record("unshare", reportId !== null && msg(await attempt(`SELECT app.set_lab_report_shared($1, false)`, [reportId])) === "OK");
      await pin("ST-07", "NIR");
      record("other clinic: lab report NOT_FOUND", reportId !== null && /lab report: NOT_FOUND/.test(msg(await attempt(`SELECT app.review_lab_report($1)`, [reportId]))));

      // --- audit ----------------------------------------------------------------------
      const events = (await c.query(`SELECT action, outcome::text, reason, metadata::text AS m FROM audit_events WHERE NOT (id = ANY ($1))`, [seen])).rows;
      const actions = new Set(events.map((e) => e.action));
      record("explicit events recorded", ["document.uploaded", "document.upload_failed", "document.archived", "lab_report.created", "lab_report.values_updated", "lab_report.reviewed", "lab_report.shared", "lab_report.unshared"].every((a) => actions.has(a)), [...actions].sort().join(","));
      record("row-change events recorded (ids + column names only)", actions.has("patient_documents.insert") && actions.has("lab_reports.update"));
      record("no titles, filenames, values or notes in any audit event", events.length > 0 && events.every((e) => !/ZZTEST|zztest\.pdf/.test(`${e.m ?? ""} ${e.reason ?? ""}`)), `${events.length} new events`);
    } finally {
      await c.query("ROLLBACK");
    }

    const after = await tableFingerprints(c, ["_prisma_migrations"]);
    const drift = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
    record("rolled back: every table identical to before", drift.length === 0, drift.join(", ") || `${Object.keys(before).length} tables identical`);
    record("rolled back: new tables and functions not present", (await c.query(`SELECT to_regclass('public.patient_documents') IS NULL AND to_regclass('public.lab_reports') IS NULL AND to_regprocedure('app.review_lab_report(uuid)') IS NULL AS gone`)).rows[0].gone === true);
    record("not recorded in _prisma_migrations", !(await c.query(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1`, [NAME])).rowCount);
  } finally {
    await c.end();
  }
  console.table(checks);
  const failed = checks.filter((x) => !x.ok);
  if (failed.length) {
    console.error(`${failed.length} dry-run check(s) FAILED. Nothing was committed.`);
    process.exit(1);
  }
  console.log(`All ${checks.length} dry-run checks passed. Nothing was committed.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
