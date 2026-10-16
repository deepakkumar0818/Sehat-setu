// The authorization core: given a VERIFIED identity (resolved server-side from
// a Supabase session and the database — never from anything the browser
// sent), decide which clinic/branch the request is scoped to and whether it
// may proceed. Pure functions with injected I/O, so every rule is unit-tested
// (authorize.test.ts). Wired to Supabase and Prisma in ./session.ts.
import { AuthError } from "./errors";

export type RoleKey = "ADMINISTRATOR" | "CLINIC_MANAGER" | "DOCTOR" | "RECEPTIONIST" | "NURSE" | "PATIENT";

export interface VerifiedAuthUser {
  /** Supabase auth.users.id, from supabase.auth.getUser() (validated by the Auth server). */
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  /**
   * Supabase user_metadata: what the user typed when registering (self-reported,
   * editable by the user — validate before use; never an authorisation input).
   */
  metadata?: Record<string, unknown>;
}

export type AuthUserLookup =
  | { status: "ok"; user: VerifiedAuthUser }
  | { status: "none" } // no session cookie at all
  | { status: "expired" }; // a session cookie was present but is no longer valid

export interface MembershipRecord {
  id: string;
  clinicId: string;
  clinicName: string;
  clinicStatus: "ACTIVE" | "SUSPENDED" | "PENDING";
  /** null = clinic-wide; otherwise restricted to this branch. */
  branchId: string | null;
  roleKey: RoleKey;
  status: "ACTIVE" | "INACTIVE";
  permissions: string[];
}

export interface Identity {
  userId: string;
  authUserId: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  memberships: MembershipRecord[];
  /** This user's doctor profiles (at most one per clinic). */
  doctorProfiles?: { id: string; clinicId: string }[];
  /** Patient records linked to this user by an administrator (patients.userId). */
  patientLinks?: { patientId: string; clinicId: string }[];
  /**
   * The sign-in email as confirmed by Supabase Auth (supabase.auth.getUser():
   * email_confirmed_at set), lower-cased; null when unconfirmed. Used to match
   * staff invitations — never taken from the browser.
   */
  verifiedEmail?: string | null;
}

/** Everything a server-side data access needs to scope a request. */
export interface TenantContext {
  authUserId: string;
  userId: string;
  email: string;
  name: string;
  clinicId: string;
  clinicName: string;
  /** null = may see every branch of the clinic. */
  branchId: string | null;
  roles: RoleKey[];
  permissions: ReadonlySet<string>;
  /** The user's doctor profile in this clinic, if any. */
  doctorId: string | null;
  /**
   * Which appointments/patients this user may see:
   *  "clinic" — everything in scope (appointment.view / checkin.manage),
   *  "own"    — only their own appointments and the patients on them (a doctor
   *             holding just own_appointments.view / assigned_patients.view),
   *  "none"   — no appointment access.
   * The database enforces the same rule independently (RLS).
   */
  careScope: "clinic" | "own" | "none";
}

/** A verified patient-portal request: one clinic, and only the patient records linked to this user there. */
export interface PatientContext {
  authUserId: string;
  userId: string;
  email: string;
  name: string;
  clinicId: string;
  clinicName: string;
  patientIds: string[];
}

function careScopeFor(permissions: ReadonlySet<string>, doctorId: string | null): TenantContext["careScope"] {
  if (permissions.has("appointment.view") || permissions.has("checkin.manage")) return "clinic";
  if (permissions.has("own_appointments.view") && doctorId) return "own";
  return "none";
}

const isUsable = (m: MembershipRecord) => m.status === "ACTIVE" && m.clinicStatus === "ACTIVE";

/**
 * Picks the clinic and branch scope for a staff request. `requestedClinicId`
 * is only a preference (e.g. from a clinic-switcher cookie) and is honoured
 * only if the user holds an active membership there.
 */
export function resolveTenantContext(identity: Identity, requestedClinicId?: string | null): TenantContext {
  if (identity.status !== "ACTIVE") throw new AuthError("ACCOUNT_DISABLED");

  const staff = identity.memberships.filter((m) => isUsable(m) && m.roleKey !== "PATIENT");
  if (staff.length === 0) throw new AuthError("NO_MEMBERSHIP");

  const clinicIds = [...new Set(staff.map((m) => m.clinicId))];
  let clinicId: string;
  if (requestedClinicId) {
    if (!clinicIds.includes(requestedClinicId)) throw new AuthError("CLINIC_FORBIDDEN");
    clinicId = requestedClinicId;
  } else {
    clinicId = [...staff].sort((a, b) => a.clinicName.localeCompare(b.clinicName) || a.clinicId.localeCompare(b.clinicId))[0].clinicId;
  }

  const inClinic = staff.filter((m) => m.clinicId === clinicId);
  let branchId: string | null;
  if (inClinic.some((m) => m.branchId === null)) {
    branchId = null;
  } else {
    const branches = [...new Set(inClinic.map((m) => m.branchId as string))];
    if (branches.length > 1) throw new AuthError("MULTIPLE_BRANCH_SCOPES");
    branchId = branches[0];
  }

  const permissions = new Set(inClinic.flatMap((m) => m.permissions));
  const doctorId = identity.doctorProfiles?.find((d) => d.clinicId === clinicId)?.id ?? null;
  return {
    authUserId: identity.authUserId,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    clinicId,
    clinicName: inClinic[0].clinicName,
    branchId,
    roles: [...new Set(inClinic.map((m) => m.roleKey))],
    permissions,
    doctorId,
    careScope: careScopeFor(permissions, doctorId),
  };
}

/**
 * The patient-portal scope: a clinic where the user holds an ACTIVE PATIENT
 * membership AND has patient records linked to them by an administrator. The
 * patient ids come only from that server-side link — never from the browser.
 */
export function resolvePatientContext(identity: Identity, requestedClinicId?: string | null): PatientContext {
  if (identity.status !== "ACTIVE") throw new AuthError("ACCOUNT_DISABLED");
  const links = identity.patientLinks ?? [];
  const patientMemberships = identity.memberships.filter((m) => isUsable(m) && m.roleKey === "PATIENT");
  if (patientMemberships.length === 0) throw new AuthError("NO_MEMBERSHIP");
  const eligible = patientMemberships
    .filter((m) => links.some((l) => l.clinicId === m.clinicId))
    .sort((a, b) => a.clinicName.localeCompare(b.clinicName) || a.clinicId.localeCompare(b.clinicId));
  // A portal account whose record link is missing or was removed: its own state (not NO_MEMBERSHIP, which
  // would send the user back to /portal). Never reveals whether a matching patient record exists.
  if (eligible.length === 0) throw new AuthError("PATIENT_NOT_LINKED");
  const chosen = (requestedClinicId && eligible.find((m) => m.clinicId === requestedClinicId)) || eligible[0];
  return {
    authUserId: identity.authUserId,
    userId: identity.userId,
    email: identity.email,
    name: identity.name,
    clinicId: chosen.clinicId,
    clinicName: chosen.clinicName,
    patientIds: links.filter((l) => l.clinicId === chosen.clinicId).map((l) => l.patientId),
  };
}

/** For queries over appointments: the doctor filter an "own"-scoped user must apply (RLS applies it too). */
export function appointmentScopeFilter(ctx: Pick<TenantContext, "careScope" | "doctorId">): { doctorId?: string } {
  if (ctx.careScope === "clinic") return {};
  if (ctx.careScope === "own" && ctx.doctorId) return { doctorId: ctx.doctorId };
  throw new AuthError("FORBIDDEN");
}

/** True if the context holds at least one of the keys (an empty list means no specific permission is needed). */
export function hasAnyPermission(ctx: Pick<TenantContext, "permissions">, anyOf: readonly string[]): boolean {
  return anyOf.length === 0 || anyOf.some((key) => ctx.permissions.has(key));
}

export function requirePermission(ctx: Pick<TenantContext, "permissions">, anyOf: string | readonly string[]): void {
  const keys = typeof anyOf === "string" ? [anyOf] : anyOf;
  if (!hasAnyPermission(ctx, keys)) throw new AuthError("FORBIDDEN");
}

/** For an operation that targets a specific branch (e.g. booking at branch X). */
export function assertBranchAccess(ctx: Pick<TenantContext, "branchId">, branchId: string): void {
  if (ctx.branchId !== null && ctx.branchId !== branchId) throw new AuthError("BRANCH_FORBIDDEN");
}

/**
 * Defence in depth on top of RLS: re-check a loaded record's ownership before
 * returning it. Another clinic's record reads as NOT_FOUND so its existence
 * isn't revealed.
 */
export function assertRecordAccess<T extends { clinicId: string; branchId?: string | null }>(ctx: Pick<TenantContext, "clinicId" | "branchId">, record: T | null | undefined): T {
  if (!record || record.clinicId !== ctx.clinicId) throw new AuthError("NOT_FOUND");
  if (ctx.branchId !== null && record.branchId != null && record.branchId !== ctx.branchId) throw new AuthError("NOT_FOUND");
  return record;
}

// ---------------------------------------------------------------------------
// Service with injected I/O
// ---------------------------------------------------------------------------

export interface AuthDeps {
  isConfigured: () => boolean;
  getAuthUser: () => Promise<AuthUserLookup>;
  loadIdentity: (user: VerifiedAuthUser) => Promise<Identity | null>;
  /** Clinic preference (e.g. a cookie) — validated, never trusted. */
  getRequestedClinicId?: () => Promise<string | null | undefined>;
}

export function createAuthService(deps: AuthDeps) {
  async function requireIdentity(): Promise<Identity> {
    if (!deps.isConfigured()) throw new AuthError("AUTH_NOT_CONFIGURED");
    const lookup = await deps.getAuthUser();
    if (lookup.status === "none") throw new AuthError("UNAUTHENTICATED");
    if (lookup.status === "expired") throw new AuthError("SESSION_EXPIRED");
    const identity = await deps.loadIdentity(lookup.user);
    if (!identity) throw new AuthError("NOT_PROVISIONED");
    // The identity must belong to the session that produced it.
    if (identity.authUserId !== lookup.user.id) throw new AuthError("UNAUTHENTICATED");
    return identity;
  }

  /** A staff request scoped to one clinic (and branch, if restricted), optionally requiring a permission. */
  async function requireStaffContext(options: { permission?: string | readonly string[] } = {}): Promise<TenantContext> {
    const identity = await requireIdentity();
    const requested = deps.getRequestedClinicId ? await deps.getRequestedClinicId() : undefined;
    let ctx: TenantContext;
    try {
      ctx = resolveTenantContext(identity, requested);
    } catch (err) {
      // A stale clinic-switcher preference shouldn't lock the user out: fall back to their default clinic.
      if (err instanceof AuthError && err.code === "CLINIC_FORBIDDEN" && requested) ctx = resolveTenantContext(identity, null);
      else throw err;
    }
    if (options.permission !== undefined) requirePermission(ctx, options.permission);
    return ctx;
  }

  /** A patient-portal request: the user must hold an active PATIENT membership. */
  async function requirePatientIdentity(): Promise<Identity> {
    const identity = await requireIdentity();
    if (identity.status !== "ACTIVE") throw new AuthError("ACCOUNT_DISABLED");
    if (!identity.memberships.some((m) => isUsable(m) && m.roleKey === "PATIENT")) throw new AuthError("NO_MEMBERSHIP");
    return identity;
  }

  /** A patient-portal request scoped to the patient records linked to this user. */
  async function requirePatientContext(): Promise<PatientContext> {
    const identity = await requireIdentity();
    const requested = deps.getRequestedClinicId ? await deps.getRequestedClinicId() : undefined;
    return resolvePatientContext(identity, requested);
  }

  return { requireIdentity, requireStaffContext, requirePatientIdentity, requirePatientContext };
}

/** Which shell a verified identity belongs in. */
export function homeFor(identity: Identity): "staff" | "portal" | null {
  const usable = identity.memberships.filter(isUsable);
  if (usable.some((m) => m.roleKey !== "PATIENT")) return "staff";
  if (usable.some((m) => m.roleKey === "PATIENT")) return "portal";
  return null;
}

/**
 * Where a signed-in user with no staff membership goes instead of Access Denied:
 * their pending staff invitation (accepting it is still an explicit step), the
 * patient portal, or nowhere (null = the normal Access Denied page).
 *
 * `countPendingInvitations` must look invitations up from the verified session
 * only (app.my_staff_invitations); it is only asked for an active account with a
 * Supabase-confirmed email. A failed lookup never blocks the normal flow.
 */
export async function noMembershipDestination(
  identity: Identity,
  countPendingInvitations: (identity: Identity & { verifiedEmail: string }) => Promise<number>
): Promise<"/invitations" | "/portal" | null> {
  if (identity.status === "ACTIVE" && identity.verifiedEmail) {
    const pending = await countPendingInvitations(identity as Identity & { verifiedEmail: string }).catch(() => 0);
    if (pending > 0) return "/invitations";
  }
  return homeFor(identity) === "portal" ? "/portal" : null;
}
