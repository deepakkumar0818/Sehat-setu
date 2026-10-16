"use server";

import { requirePatient } from "@/server/auth/session";
import { isAuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { completeIntake, getIntakeState, saveIntakeMedical, saveIntakePersonal, skipIntakeMedical, submitSymptomReport } from "@/server/data/patient-intake";
import { fieldErrors, medicalSchema, personalSchema, symptomSchema, type IntakeState } from "@/lib/patient-intake";
import { reportServerError } from "@/server/monitoring";
import type { PatientContext } from "@/server/auth/authorize";

// First-login onboarding (P6.5) Server Actions. Each one re-verifies the
// session (requirePatient: verified Supabase user + ACTIVE PATIENT membership +
// a record linked by the clinic's code) — rendering the dialog is not a
// security boundary. Input is strict (no patient, clinic or user ids are
// accepted); the database takes the patient from the session. Answers are
// never logged; errors carry codes only.

export type IntakeActionResult =
  | { ok: true; state: IntakeState }
  | {
      ok: false;
      error: "signed_out" | "forbidden" | "invalid_input" | "unavailable" | "conflict" | "rate_limited";
      message: string;
      /** Per-field messages (never the values typed). */
      fields?: Record<string, string>;
    };

const SCOPE = "action patient_intake";
type Fail = Extract<IntakeActionResult, { ok: false }>;
const fail = (error: Fail["error"], message: string, fields?: Record<string, string>): Fail => ({ ok: false, error, message, ...(fields ? { fields } : {}) });

/** The verified patient, or the refusal to return. */
async function authorize(): Promise<{ ctx: PatientContext } | Fail> {
  try {
    return { ctx: await requirePatient(SCOPE) };
  } catch (err) {
    if (isAuthError(err) && (err.code === "UNAUTHENTICATED" || err.code === "SESSION_EXPIRED")) return fail("signed_out", "Your session has ended. Please sign in again — your saved answers are kept.");
    if (isAuthError(err)) return fail("forbidden", "Your account can't update this profile. Please contact your clinic.");
    reportServerError(SCOPE, err);
    return fail("unavailable", "Couldn't reach the server. Please try again.");
  }
}

async function run(work: (ctx: PatientContext) => Promise<void>): Promise<IntakeActionResult> {
  const auth = await authorize();
  if (!("ctx" in auth)) return auth;
  const { ctx } = auth;
  try {
    await work(ctx);
    return { ok: true, state: await getIntakeState(ctx) };
  } catch (err) {
    if (isAuthError(err)) return fail("forbidden", "Your account can't update this profile. Please contact your clinic.");
    if (err instanceof DataError) {
      if (err.code === "INVALID_INPUT") return fail("invalid_input", err.message);
      if (err.code === "RATE_LIMITED") return fail("rate_limited", err.message);
      if (err.code === "CONFLICT") return fail("conflict", err.message);
      return fail("unavailable", err.message);
    }
    reportServerError(SCOPE, err);
    return fail("unavailable", "Couldn't save right now. Your earlier steps are kept — please try again.");
  }
}

function invalid(error: import("zod").ZodError): IntakeActionResult {
  return fail("invalid_input", "Please check the highlighted answers.", fieldErrors(error));
}

/** Step 1. */
export async function saveIntakePersonalAction(input: unknown): Promise<IntakeActionResult> {
  const parsed = personalSchema().safeParse(input);
  if (!parsed.success) return withAuth(() => invalid(parsed.error));
  return run((ctx) => saveIntakePersonal(ctx, parsed.data));
}

/** Step 2 (every field optional). */
export async function saveIntakeMedicalAction(input: unknown): Promise<IntakeActionResult> {
  const parsed = medicalSchema.safeParse(input);
  if (!parsed.success) return withAuth(() => invalid(parsed.error));
  return run((ctx) => saveIntakeMedical(ctx, parsed.data));
}

/** Step 2 skipped: marks it seen without changing any answer. */
export async function skipIntakeMedicalAction(): Promise<IntakeActionResult> {
  return run((ctx) => skipIntakeMedical(ctx));
}

/** Step 3: a NEW pre-visit questionnaire (earlier ones are kept). */
export async function submitIntakeSymptomsAction(input: unknown): Promise<IntakeActionResult> {
  const parsed = symptomSchema.safeParse(input);
  if (!parsed.success) return withAuth(() => invalid(parsed.error));
  return run(async (ctx) => {
    await submitSymptomReport(ctx, parsed.data);
  });
}

/** Marks onboarding complete (needs step 1 saved; steps 2 and 3 are optional). */
export async function completeIntakeAction(): Promise<IntakeActionResult> {
  return run((ctx) => completeIntake(ctx));
}

/**
 * Validation errors are only reported to a verified patient: an unauthenticated
 * caller learns nothing about the expected shape.
 */
async function withAuth(onAuthorized: () => IntakeActionResult): Promise<IntakeActionResult> {
  const auth = await authorize();
  return "ctx" in auth ? onAuthorized() : auth;
}
