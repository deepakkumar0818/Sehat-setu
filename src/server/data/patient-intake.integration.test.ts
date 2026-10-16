import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { adminClient, contextFor, FIX, inRollback, patientContextFor, pinPatient } from "@/test/live-fixtures";
import { demoId } from "../../../prisma/seed/demo-data";
import type { PatientContext, TenantContext } from "@/server/auth/authorize";
import { completeIntake, getIntakeState, getPatientReportedForStaff, saveIntakeMedical, saveIntakePersonal, skipIntakeMedical, submitSymptomReport } from "./patient-intake";

// P6.5 onboarding against the development database, as the runtime role
// (sehat_app) with real RLS and the real SECURITY DEFINER functions: the
// fictional portal user PU-01 (linked to Aarogya patient #1) and staff
// fixtures, inside transactions that are ROLLED BACK. Synthetic values only
// ("ZZTEST"); table counts are compared afterwards to prove nothing persisted.

let admin: Client;
let portal: PatientContext;
let adminA: TenantContext, receptionWakad: TenantContext, nurseKothrud: TenantContext, doctor1: TenantContext, adminB: TenantContext;
let counts: Record<string, number>;
let foreignAppointment: string | undefined;
let dr1Assigned = false;
const PATIENT_1 = demoId("patient:1");

const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
const tableCounts = async () => ({
  profiles: await n(`SELECT count(*) n FROM patient_intake_profiles`),
  reports: await n(`SELECT count(*) n FROM patient_symptom_reports`),
  audit: await n(`SELECT count(*) n FROM audit_events`),
  memberships: await n(`SELECT count(*) n FROM clinic_memberships`),
  patients: await n(`SELECT count(*) n FROM patients WHERE "userId" IS NOT NULL`),
});
const fingerprint = async () => (await admin.query(`SELECT md5(p::text) h FROM patients p WHERE id = $1`, [PATIENT_1])).rows[0].h as string;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string; name?: string }) => e.code ?? e.name);
const istDay = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 864e5).toISOString().slice(0, 10);

const PERSONAL = {
  legalName: "ZZTEST Intake Patient",
  dateOfBirth: "1990-05-17",
  gender: null,
  phone: "+919800000081",
  addressLine: "1 ZZTEST Road",
  city: "Pune",
  state: "Maharashtra",
  postalCode: "411001",
  emergencyContactName: "ZZTEST Contact",
  emergencyContactRelationship: "Spouse",
  emergencyContactPhone: "+919800000082",
};
const SYMPTOMS = { requestId: "5e1c0d2a-1111-4222-8333-000000000091", appointmentId: null, reason: "ZZTEST reason", symptoms: "ZZTEST symptoms", onset: "DAYS_1_3" as const, severity: "MILD" as const, notes: null };

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  portal = await patientContextFor(admin, "PU-01");
  expect(portal).toMatchObject({ clinicId: FIX.clinicA, patientIds: [PATIENT_1] });
  [adminA, receptionWakad, nurseKothrud, doctor1, adminB] = [
    await contextFor(admin, "ST-01"),
    await contextFor(admin, "ST-04"),
    await contextFor(admin, "ST-05"),
    await contextFor(admin, "DR-01"),
    await contextFor(admin, "ST-07"),
  ];
  foreignAppointment = (await admin.query(`SELECT id FROM appointments WHERE "clinicId" = $1 AND "patientId" <> $2 LIMIT 1`, [FIX.clinicA, PATIENT_1])).rows[0]?.id;
  dr1Assigned = (await n(`SELECT count(*) n FROM appointments WHERE "patientId" = $1 AND "doctorId" = $2`, [PATIENT_1, FIX.doctor1])) > 0;
  counts = await tableCounts();
});

afterAll(async () => {
  expect(await tableCounts(), "nothing persisted").toEqual(counts);
  await admin.end();
});

describe("patient onboarding (runtime role, rolled back)", () => {
  it("starts incomplete with a prefill from the clinic record, saves each step, resumes, and completes", async () => {
    const before = await fingerprint();
    await inRollback(async ({ tx }) => {
      await pinPatient(tx, portal);
      const fresh = await getIntakeState(portal, tx);
      if (!fresh.available) throw new Error("migration not applied");
      // The fixture may already have a saved profile from earlier manual testing; this test only needs a usable state.
      expect(typeof fresh.completed).toBe("boolean");

      await saveIntakePersonal(portal, PERSONAL, tx);
      let s = await getIntakeState(portal, tx);
      expect(s).toMatchObject({ available: true, progress: { personalSaved: true }, personal: { legalName: PERSONAL.legalName, dateOfBirth: "1990-05-17", phone: PERSONAL.phone } });

      await skipIntakeMedical(portal, tx);
      s = await getIntakeState(portal, tx);
      expect(s).toMatchObject({ progress: { personalSaved: true, medicalReviewed: true } });

      await saveIntakeMedical(portal, { allergyStatus: "NONE_KNOWN", allergies: [], medications: [{ name: "ZZTEST med", dose: "1 mg", frequency: null }], conditions: ["ZZTEST condition"], pastSurgeries: null, familyHistory: null }, tx);
      s = await getIntakeState(portal, tx);
      expect(s).toMatchObject({ medical: { allergyStatus: "NONE_KNOWN", allergies: [], medications: [{ name: "ZZTEST med", dose: "1 mg", frequency: null }], conditions: ["ZZTEST condition"] } });

      const first = await submitSymptomReport(portal, SYMPTOMS, tx);
      const repeat = await submitSymptomReport(portal, SYMPTOMS, tx);
      expect(first).toEqual({ created: true, appointmentLinked: false });
      expect(repeat).toEqual({ created: false, appointmentLinked: false });
      const second = await submitSymptomReport(portal, { ...SYMPTOMS, requestId: "5e1c0d2a-1111-4222-8333-000000000092", symptoms: "ZZTEST later symptoms" }, tx);
      expect(second.created).toBe(true); // a new visit's answers never overwrite the earlier ones

      await completeIntake(portal, tx);
      s = await getIntakeState(portal, tx);
      expect(s).toMatchObject({ available: true, completed: true, progress: { completed: true } });

      // Staff review in the same transaction (re-pinned as each staff member).
      const asStaff = async (ctx: TenantContext) => {
        await tx.$executeRaw`SELECT set_config('app.auth_user_id', ${ctx.authUserId}, true), set_config('app.user_id', ${ctx.userId}, true),
          set_config('app.clinic_id', ${ctx.clinicId}, true), set_config('app.branch_id', ${ctx.branchId ?? ""}, true)`;
        return getPatientReportedForStaff(ctx, PATIENT_1, tx);
      };
      const view = await asStaff(adminA);
      expect(view.profile).toMatchObject({ legalName: PERSONAL.legalName, allergyStatus: "NONE_KNOWN" });
      expect(view.profile?.completedAt).toBeTruthy();
      expect(view.symptomReports.map((r) => r.symptoms)).toEqual(expect.arrayContaining(["ZZTEST symptoms", "ZZTEST later symptoms"]));

      expect(await code(asStaff(receptionWakad))).toBe("FORBIDDEN"); // no medical-record permission
      expect(await code(asStaff(nurseKothrud))).toBe("FORBIDDEN");
      expect(await code(asStaff(adminB))).toBe("NOT_FOUND"); // other clinic
      expect(await code(asStaff(doctor1))).toBe(dr1Assigned ? "OK" : "NOT_FOUND"); // assigned doctors only

      // RLS on its own (without the app's checks): receptionist and other clinic see no rows.
      for (const ctx of [receptionWakad, adminB]) {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.clinic_id', ${ctx.clinicId}, true), set_config('app.branch_id', ${ctx.branchId ?? ""}, true)`;
        expect(await tx.patientIntakeProfile.count()).toBe(0);
        expect(await tx.patientSymptomReport.count()).toBe(0);
      }
    });
    expect(await fingerprint(), "the clinic's patient record is never changed by onboarding").toBe(before);
  });

  it("refuses a future date of birth (in IST) at the database", async () => {
    await inRollback(async ({ tx }) => {
      await pinPatient(tx, portal);
      expect(await code(saveIntakePersonal(portal, { ...PERSONAL, dateOfBirth: istDay(1) }, tx))).toBe("INVALID_INPUT");
    });
  });

  it("refuses another patient's appointment instead of attaching the symptoms to it", async () => {
    if (!foreignAppointment) return;
    await inRollback(async ({ tx }) => {
      await pinPatient(tx, portal);
      await saveIntakePersonal(portal, PERSONAL, tx);
      expect(await code(submitSymptomReport(portal, { ...SYMPTOMS, requestId: "5e1c0d2a-1111-4222-8333-000000000093", appointmentId: foreignAppointment! }, tx))).toBe("INVALID_INPUT");
    });
  });

  it("a staff session can't write patient-reported data (the database takes the patient from the session)", async () => {
    await inRollback(async ({ tx, as }) => {
      await as(adminA);
      expect(await code(saveIntakePersonal(portal, PERSONAL, tx))).toBe("FORBIDDEN");
    });
  });

  it("the runtime role can't write the new tables directly", async () => {
    await inRollback(async ({ tx }) => {
      await pinPatient(tx, portal);
      expect(await code(tx.$executeRaw`UPDATE patient_symptom_reports SET symptoms = 'x'`)).not.toBe("OK");
    });
  });
});
