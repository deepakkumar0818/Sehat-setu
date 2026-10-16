import "server-only";
import { requirePermission, type PatientContext, type TenantContext } from "@/server/auth/authorize";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import type { TenantTx } from "@/server/db/tenant";
import type { AllergyItem, IntakeAppointmentOption, IntakeMedicalView, IntakeProfileView, IntakeState, MedicalData, MedicationItem, PatientReportedView, PersonalData, SymptomData } from "@/lib/patient-intake";
import { lookupNames } from "./documents";
import { errorText, uuid } from "./document-rules";
import { runPatientScoped, runScoped } from "./scope";

// First-login patient onboarding (P6.5, migration 20261023000000_patient_intake).
//
// Who: PatientContext only — a verified session with an ACTIVE PATIENT
// membership and a record linked by the clinic's one-time code. Nothing here
// creates or changes a link, a membership or the clinic's patient record.
// Reads run in the patient's own transaction (RLS: own rows only). Writes call
// SECURITY DEFINER functions that take the patient from
// app.current_patient_ids() — never an id from the browser — and re-validate
// every field. Answers are patient-reported and never a diagnosis.
//
// Until the migration is applied, getIntakeState() reports
// { available: false } and the portal simply doesn't offer onboarding.

// Includes the patient's own pending requests (the questionnaire can be filled in while reception decides).
const UPCOMING_STATUSES = ["PENDING_APPROVAL", "SCHEDULED", "CONFIRMED"] as const;
const APPOINTMENT_GRACE_MS = 12 * 60 * 60 * 1000; // matches the function's "startsAt > now() - 12 hours"

/** True when the onboarding tables/functions don't exist yet (migration not applied). */
export function isMissingIntakeSchema(err: unknown): boolean {
  return /(relation "(public\.)?patient_(intake_profiles|symptom_reports)" does not exist|function app\.(save_patient_intake_\w+|skip_patient_intake_medical|submit_patient_symptom_report|complete_patient_intake)\([^)]*\) does not exist|P2021)/i.test(errorText(err));
}

const MESSAGES: Record<string, [ConstructorParameters<typeof DataError>[0], string]> = {
  INVALID_INPUT: ["INVALID_INPUT", "Some answers aren't valid. Please check them and try again."],
  PERSONAL_FIRST: ["CONFLICT", "Please save your personal information first."],
  APPOINTMENT_NOT_FOUND: ["INVALID_INPUT", "That appointment isn't available any more. Choose another, or save without linking an appointment."],
  RATE_LIMITED: ["RATE_LIMITED", "You've sent several symptom updates today. Please contact your clinic directly."],
};

/** Maps a 'patient intake: <CODE>' refusal (or a missing migration) to an API error; anything else is rethrown. */
export function mapIntakeDbError(err: unknown): never {
  if (isMissingIntakeSchema(err)) throw new DataError("FEATURE_UNAVAILABLE", "Your health profile isn't available yet. Please try again later.");
  const m = /patient intake: ([A-Z_]+)/.exec(errorText(err));
  if (!m) throw err;
  if (m[1] === "NOT_PERMITTED") throw new AuthError("FORBIDDEN");
  const known = MESSAGES[m[1]];
  if (!known) throw err;
  throw new DataError(known[0], known[1]);
}

async function schemaPresent(tx: TenantTx): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regclass('public.patient_intake_profiles') IS NOT NULL
       AND to_regclass('public.patient_symptom_reports') IS NOT NULL
       AND to_regprocedure('app.complete_patient_intake()') IS NOT NULL AS ok`;
  return Boolean(row?.ok);
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const str = (v: unknown) => (typeof v === "string" ? v : null);

function allergiesOf(raw: unknown): AllergyItem[] {
  return Array.isArray(raw)
    ? raw.filter((v) => v && typeof v === "object" && typeof v.substance === "string").map((v) => ({ substance: v.substance as string, reaction: str(v.reaction) }))
    : [];
}
function medicationsOf(raw: unknown): MedicationItem[] {
  return Array.isArray(raw)
    ? raw.filter((v) => v && typeof v === "object" && typeof v.name === "string").map((v) => ({ name: v.name as string, dose: str(v.dose), frequency: str(v.frequency) }))
    : [];
}

/**
 * The signed-in patient's onboarding state (server-side truth). Never throws
 * for a missing migration: that is { available: false }.
 */
export async function getIntakeState(ctx: PatientContext, db?: TenantTx, now: Date = new Date()): Promise<IntakeState> {
  return runPatientScoped(ctx, db, async (tx) => {
    if (!(await schemaPresent(tx))) return { available: false };
    const [profile, record, appointments, recentSymptomReports] = await Promise.all([
      tx.patientIntakeProfile.findFirst({ where: { clinicId: ctx.clinicId, patientId: { in: ctx.patientIds } } }),
      // The clinic's record of this patient, for a starting point only (read; never written).
      tx.patient.findFirst({
        where: { clinicId: ctx.clinicId, id: { in: ctx.patientIds } },
        select: { name: true, dateOfBirth: true, gender: true, phone: true, addressLine: true, city: true, emergencyContactName: true, emergencyContactPhone: true },
      }),
      tx.appointment.findMany({
        where: { clinicId: ctx.clinicId, patientId: { in: ctx.patientIds }, status: { in: [...UPCOMING_STATUSES] }, startsAt: { gt: new Date(now.getTime() - APPOINTMENT_GRACE_MS) } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 5,
        select: { id: true, startsAt: true, branchId: true, doctorId: true },
      }),
      tx.patientSymptomReport.count({ where: { clinicId: ctx.clinicId, patientId: { in: ctx.patientIds }, createdAt: { gt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } }),
    ]);

    const names = await lookupNames(tx, { branches: appointments.map((a) => a.branchId), doctors: appointments.map((a) => a.doctorId) });
    const options: IntakeAppointmentOption[] = appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      branchName: names.branch.get(a.branchId)?.name ?? null,
      doctorName: names.doctor.get(a.doctorId)?.name ?? null,
    }));

    const personal: Partial<IntakeProfileView> = profile
      ? {
          legalName: profile.legalName,
          dateOfBirth: dateOnly(profile.dateOfBirth),
          gender: profile.gender,
          phone: profile.phone,
          addressLine: profile.addressLine,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postalCode,
          emergencyContactName: profile.emergencyContactName,
          emergencyContactRelationship: profile.emergencyContactRelationship,
          emergencyContactPhone: profile.emergencyContactPhone,
        }
      : record
        ? {
            legalName: record.name,
            dateOfBirth: dateOnly(record.dateOfBirth),
            gender: record.gender,
            phone: record.phone,
            addressLine: record.addressLine ?? "",
            city: record.city ?? "",
            emergencyContactName: record.emergencyContactName,
            emergencyContactPhone: record.emergencyContactPhone,
          }
        : {};
    const medical: IntakeMedicalView | null = profile
      ? {
          allergyStatus: profile.allergyStatus,
          allergies: allergiesOf(profile.allergies),
          medications: medicationsOf(profile.medications),
          conditions: profile.conditions,
          pastSurgeries: profile.pastSurgeries,
          familyHistory: profile.familyHistory,
        }
      : null;
    const progress = { personalSaved: Boolean(profile), medicalReviewed: Boolean(profile?.medicalReviewedAt), completed: Boolean(profile?.completedAt) };
    return { available: true, completed: progress.completed, progress, personal, medical, appointments: options, recentSymptomReports };
  });
}

export async function saveIntakePersonal(ctx: PatientContext, data: PersonalData, db?: TenantTx): Promise<void> {
  await runPatientScoped(ctx, db, async (tx) => {
    try {
      await tx.$queryRaw`SELECT app.save_patient_intake_personal(
        ${data.legalName}, ${data.dateOfBirth}::date, ${data.gender}, ${data.phone},
        ${data.addressLine}, ${data.city}, ${data.state}, ${data.postalCode},
        ${data.emergencyContactName}, ${data.emergencyContactRelationship}, ${data.emergencyContactPhone})::text`;
    } catch (err) {
      mapIntakeDbError(err);
    }
  });
}

export async function saveIntakeMedical(ctx: PatientContext, data: MedicalData, db?: TenantTx): Promise<void> {
  await runPatientScoped(ctx, db, async (tx) => {
    try {
      await tx.$queryRaw`SELECT app.save_patient_intake_medical(
        ${data.allergyStatus}, ${JSON.stringify(data.allergies)}::jsonb, ${JSON.stringify(data.medications)}::jsonb,
        ${data.conditions}::text[], ${data.pastSurgeries}, ${data.familyHistory})::text`;
    } catch (err) {
      mapIntakeDbError(err);
    }
  });
}

export async function skipIntakeMedical(ctx: PatientContext, db?: TenantTx): Promise<void> {
  await runPatientScoped(ctx, db, async (tx) => {
    try {
      await tx.$queryRaw`SELECT app.skip_patient_intake_medical()::text`;
    } catch (err) {
      mapIntakeDbError(err);
    }
  });
}

/** Appends one questionnaire (a repeat of the same requestId returns the first). */
export async function submitSymptomReport(ctx: PatientContext, data: SymptomData, db?: TenantTx): Promise<{ created: boolean; appointmentLinked: boolean }> {
  return runPatientScoped(ctx, db, async (tx) => {
    try {
      const [row] = await tx.$queryRaw<{ report_id: string; appointment_id: string | null; created: boolean }[]>`
        SELECT report_id, appointment_id, created FROM app.submit_patient_symptom_report(
          ${data.requestId}::uuid, ${data.appointmentId}::uuid, ${data.reason}, ${data.symptoms},
          ${data.onset}, ${data.severity}, ${data.notes})`;
      return { created: row.created, appointmentLinked: row.appointment_id !== null };
    } catch (err) {
      mapIntakeDbError(err);
    }
  });
}

export async function completeIntake(ctx: PatientContext, db?: TenantTx): Promise<void> {
  await runPatientScoped(ctx, db, async (tx) => {
    try {
      await tx.$queryRaw`SELECT app.complete_patient_intake()::text`;
    } catch (err) {
      mapIntakeDbError(err);
    }
  });
}

// --- Staff review -------------------------------------------------------------------------

/**
 * Who may ask (first gate; the database decides per patient with
 * app.patient_reported_visible): the existing medical-record permissions.
 * Receptionists, nurses, lab, pharmacy and billing staff hold none of them.
 */
export const PATIENT_REPORTED_READ = ["medical_record.view", "medical_record.manage", "patient.medical_record.view"] as const;

/**
 * A patient's patient-reported onboarding answers and symptom questionnaires,
 * for authorized staff. Read-only. A patient the caller may not see is a 404
 * (audited as patient_intake.access_denied); a successful view is audited as
 * patient_intake.viewed (ids only).
 */
export async function getPatientReportedForStaff(ctx: TenantContext, patientId: string, db?: TenantTx): Promise<PatientReportedView> {
  requirePermission(ctx, PATIENT_REPORTED_READ);
  if (!uuid.safeParse(patientId).success) throw new AuthError("NOT_FOUND");
  const result = await runScoped(ctx, db, async (tx) => {
    if (!(await schemaPresent(tx))) throw new DataError("FEATURE_UNAVAILABLE", "Patient-reported information isn't available yet.");
    const [gate] = await tx.$queryRaw<{ visible: boolean }[]>`SELECT app.patient_reported_visible(${patientId}::uuid) AS visible`;
    if (!gate?.visible) {
      await tx.$executeRaw`SELECT app.log_event('patient_intake.access_denied', 'DENIED', 'patients', ${patientId}, 'not_visible', NULL, NULL, NULL)`;
      return null;
    }
    // RLS (patient_intake_profiles_read / patient_symptom_reports_read) applies the same rule again.
    const [profile, reports] = await Promise.all([
      tx.patientIntakeProfile.findFirst({ where: { clinicId: ctx.clinicId, patientId } }),
      tx.patientSymptomReport.findMany({ where: { clinicId: ctx.clinicId, patientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }),
    ]);
    const apptIds = [...new Set(reports.map((r) => r.appointmentId).filter((x): x is string => Boolean(x)))];
    // Only appointments the caller may see (appointments RLS); otherwise just "linked".
    const appts = apptIds.length ? await tx.appointment.findMany({ where: { clinicId: ctx.clinicId, id: { in: apptIds } }, select: { id: true, startsAt: true } }) : [];
    const startsAt = new Map(appts.map((a) => [a.id, a.startsAt.toISOString()]));
    await tx.$executeRaw`SELECT app.log_event('patient_intake.viewed', 'SUCCESS', 'patients', ${patientId}, NULL, NULL, NULL, NULL)`;
    const view: PatientReportedView = {
      profile: profile
        ? {
            legalName: profile.legalName,
            dateOfBirth: dateOnly(profile.dateOfBirth),
            gender: profile.gender,
            phone: profile.phone,
            addressLine: profile.addressLine,
            city: profile.city,
            state: profile.state,
            postalCode: profile.postalCode,
            emergencyContactName: profile.emergencyContactName,
            emergencyContactRelationship: profile.emergencyContactRelationship,
            emergencyContactPhone: profile.emergencyContactPhone,
            allergyStatus: profile.allergyStatus,
            allergies: allergiesOf(profile.allergies),
            medications: medicationsOf(profile.medications),
            conditions: profile.conditions,
            pastSurgeries: profile.pastSurgeries,
            familyHistory: profile.familyHistory,
            personalSavedAt: profile.personalSavedAt.toISOString(),
            medicalReviewedAt: profile.medicalReviewedAt?.toISOString() ?? null,
            completedAt: profile.completedAt?.toISOString() ?? null,
            updatedAt: profile.updatedAt.toISOString(),
          }
        : null,
      symptomReports: reports.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        appointmentLinked: r.appointmentId !== null,
        appointmentAt: r.appointmentId ? (startsAt.get(r.appointmentId) ?? null) : null,
        reason: r.reason,
        symptoms: r.symptoms,
        onset: r.onset,
        severity: r.severity,
        notes: r.notes,
      })),
    };
    return view;
  });
  if (!result) throw new AuthError("NOT_FOUND"); // after committing the denial audit
  return result;
}
