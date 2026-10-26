import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { staffRoutePermissions } from "@/lib/auth/routes";
import { primaryUserRole, type ServerSessionUser } from "@/lib/auth/session-user";
import { createSupabaseServerClient, hasSupabaseSessionCookie } from "@/server/supabase";
import { withIdentityDb } from "@/server/db/tenant";
import { findUserAndPin, loadMembershipsAndLinks } from "@/server/auth/identity-db";
import { AuthError, isAuthError } from "@/server/auth/errors";
import { recordAuditEvent } from "@/server/audit";
import { reportEvent } from "@/server/monitoring";
import { findOrLinkUser } from "@/server/auth/link-user";
import {
  createAuthService,
  homeFor,
  hasAnyPermission,
  noMembershipDestination,
  type AuthUserLookup,
  type Identity,
  type PatientContext,
  type TenantContext,
  type VerifiedAuthUser,
} from "@/server/auth/authorize";

/** Cookie holding the user's preferred clinic. A hint only — always re-validated against memberships. */
export const ACTIVE_CLINIC_COOKIE = "sehat_active_clinic";

// Auth-server answers per session, so a page firing several API calls at once
// (each its own request) doesn't wait on the Auth server for each one: that
// round-trip is ~0.1s warm and >1s on a fresh connection. Every request still
// verifies the session token's signature and expiry locally (getClaims: ES256
// against Supabase's public key, which auth-js caches), and only a token whose
// session the Auth server confirmed within SESSION_RECHECK_MS is served from
// here. A server-side sign-out (or a revoked session) therefore takes effect
// within that window; signing out through /auth/signout forgets it at once.
const SESSION_RECHECK_MS = 60_000;
const verifiedSessions = new Map<string, { user: VerifiedAuthUser; until: number }>();

function rememberSession(key: string, user: VerifiedAuthUser, tokenExpiresAt: number): void {
  const now = Date.now();
  if (verifiedSessions.size >= 1000) {
    for (const [k, v] of verifiedSessions) if (v.until <= now) verifiedSessions.delete(k);
    if (verifiedSessions.size >= 1000) verifiedSessions.clear();
  }
  verifiedSessions.set(key, { user, until: Math.min(now + SESSION_RECHECK_MS, tokenExpiresAt * 1000) });
}

/** Drop the remembered sessions of one Supabase user (called on sign-out). */
export function forgetVerifiedSessions(authUserId: string): void {
  for (const key of verifiedSessions.keys()) if (key.startsWith(`${authUserId}:`)) verifiedSessions.delete(key);
}

/** Who the session belongs to: the JWT is verified on every call, and confirmed with the Supabase Auth server at least once a minute (never trusts cookie contents alone). */
async function getAuthUser(): Promise<AuthUserLookup> {
  const supabase = await createSupabaseServerClient();
  const { data: verified } = await supabase.auth.getClaims();
  const claims = verified?.claims;
  const key = claims?.sub && claims.session_id ? `${claims.sub}:${claims.session_id}` : null;
  const known = key ? verifiedSessions.get(key) : undefined;
  if (known && known.until > Date.now()) return { status: "ok", user: known.user };

  const { data, error } = await supabase.auth.getUser();
  if (data.user) {
    const user = { id: data.user.id, email: data.user.email ?? null, emailConfirmed: Boolean(data.user.email_confirmed_at), metadata: data.user.user_metadata ?? {} };
    if (key && claims && claims.sub === user.id) rememberSession(key, user, claims.exp);
    return { status: "ok", user };
  }
  if (key) verifiedSessions.delete(key);
  if (error?.name === "AuthRetryableFetchError") throw new AuthError("AUTH_UNAVAILABLE");
  return { status: (await hasSupabaseSessionCookie()) ? "expired" : "none" };
}

/**
 * Maps a verified Supabase user to the application User and memberships,
 * linking an INVITED user on first sign-in by confirmed email (via the
 * app.link_auth_user SECURITY DEFINER function).
 */
async function loadIdentity(authUser: VerifiedAuthUser): Promise<Identity | null> {
  let justLinked = false;
  const identity = await withIdentityDb(authUser.id, async (tx) => {
    // findUserAndPin also pins app.user_id when it finds the row (one round-trip instead of two).
    const { user, linkedNow } = await findOrLinkUser(authUser, {
      findByAuthId: () => findUserAndPin(tx, authUser.id),
      link: async () => {
        const [{ linked }] = await tx.$queryRaw<{ linked: string | null }[]>`SELECT app.link_auth_user(${authUser.id}, ${authUser.email})::text AS linked`;
        return linked;
      },
    });
    justLinked = linkedNow;
    if (!user || user.authProviderId !== authUser.id) return null;

    // Own rows only (RLS: memberships/doctor_profiles/patients where userId = this user).
    const { memberships, doctorProfiles, patientLinks } = await loadMembershipsAndLinks(tx, user.id);

    return {
      userId: user.id,
      authUserId: authUser.id,
      email: user.email,
      verifiedEmail: authUser.emailConfirmed && authUser.email ? authUser.email.trim().toLowerCase() : null,
      name: user.name,
      status: user.status,
      doctorProfiles,
      patientLinks,
      memberships,
    };
  });
  if (justLinked && identity) {
    await recordAuditEvent({ action: "auth.account_linked", outcome: "SUCCESS", actor: { userId: identity.userId, authUserId: authUser.id }, targetType: "user", targetId: identity.userId });
  }
  return identity;
}

const authService = createAuthService({
  isConfigured: isSupabaseAuthEnabled,
  getAuthUser,
  loadIdentity,
  getRequestedClinicId: async () => (await cookies()).get(ACTIVE_CLINIC_COOKIE)?.value,
});

// cache(): resolve the session at most once per request, however many
// layouts, pages, and data helpers ask for it.
export const requireIdentity = cache(() => authService.requireIdentity());
export const requireStaffContext = cache(() => authService.requireStaffContext());
export const requirePatientIdentity = cache(() => authService.requirePatientIdentity());
export const requirePatientContext = cache(() => authService.requirePatientContext());

/**
 * The Supabase-verified user behind this session, whether or not they have an
 * application account yet (P6.4: a self-registered patient redeeming a linking
 * code). Validated by the Auth server (getUser()); grants nothing by itself.
 */
export const requireAuthUser = cache(async (): Promise<VerifiedAuthUser> => {
  if (!isSupabaseAuthEnabled()) throw new AuthError("AUTH_NOT_CONFIGURED");
  const lookup = await getAuthUser();
  if (lookup.status === "none") throw new AuthError("UNAUTHENTICATED");
  if (lookup.status === "expired") throw new AuthError("SESSION_EXPIRED");
  return lookup.user;
});

/** Where a signed-in login with no application account goes: the linking-code page (P6.4 self-registration). */
export const LINK_ACCOUNT_PATH = "/link-account";

/** Audit an authorization failure (unauthenticated visits are not logged — the proxy turns those away). */
async function auditDenied(err: AuthError, resource: string): Promise<void> {
  if (err.code === "AUTH_NOT_CONFIGURED" || err.code === "UNAUTHENTICATED") return;
  reportEvent("access_denied", { scope: resource, reason: err.code, status: err.status });
  const identity = await requireIdentity().catch(() => null);
  await recordAuditEvent({
    action: "access.denied",
    outcome: "DENIED",
    actor: { userId: identity?.userId, authUserId: identity?.authUserId },
    targetType: "route",
    targetId: resource.slice(0, 128),
    reason: err.code,
  });
}

/** For Route Handlers and Server Actions: the verified staff context, optionally requiring a permission. */
export async function requireStaff(permission?: string | readonly string[], resource = "server-operation"): Promise<TenantContext> {
  try {
    const ctx = await requireStaffContext();
    if (permission !== undefined && !hasAnyPermission(ctx, typeof permission === "string" ? [permission] : permission)) {
      throw new AuthError("FORBIDDEN");
    }
    return ctx;
  } catch (err) {
    if (isAuthError(err)) await auditDenied(err, resource);
    throw err;
  }
}

/**
 * For patient-portal Route Handlers: the verified patient context (P6.3). The
 * patient record ids come only from the server-side link; refusals are audited
 * like staff refusals (unauthenticated requests are not).
 */
export async function requirePatient(resource: string): Promise<PatientContext> {
  try {
    return await requirePatientContext();
  } catch (err) {
    if (isAuthError(err)) await auditDenied(err, resource);
    throw err;
  }
}

/** Where to send a page request that failed authentication/authorization. */
export function authErrorDestination(err: AuthError, nextPath?: string): string {
  const next = nextPath ? `&next=${encodeURIComponent(nextPath)}` : "";
  switch (err.code) {
    case "UNAUTHENTICATED":
      return `/login?reason=signin${next}`;
    case "SESSION_EXPIRED":
      return `/login?reason=expired${next}`;
    default:
      return `/access-denied?reason=${err.code.toLowerCase()}`;
  }
}

/** Pending (or expired, still-pending) invitations for the verified session — never for a browser-supplied email. */
async function countPendingInvitations(identity: Identity & { verifiedEmail: string }): Promise<number> {
  // Imported lazily: the data layer depends on this module's neighbours.
  const { listMyInvitations } = await import("@/server/data/invitations");
  return (await listMyInvitations(identity)).items.length;
}

/**
 * For a signed-in user who has no staff membership: where to send them instead of
 * Access Denied (their invitation, or the patient portal), or null.
 */
export async function noMembershipRedirect(): Promise<string | null> {
  const identity = await requireIdentity().catch(() => null);
  return identity ? noMembershipDestination(identity, countPendingInvitations) : null;
}

function redirectOnAuthError(err: unknown, nextPath?: string): never {
  if (isAuthError(err)) redirect(authErrorDestination(err, nextPath));
  throw err;
}

/**
 * Server-layout guard for a staff route segment. In demo mode (Supabase not
 * configured) it does nothing — that mode serves only fictional client-side
 * mock data, and every database helper refuses to run without a verified session.
 */
export async function guardStaffRoute(pathname: string | null): Promise<TenantContext | null> {
  // Always render protected pages per request — never serve a build-time
  // prerender that skipped this check.
  await connection();
  if (!isSupabaseAuthEnabled()) return null;
  // null = the staff shell itself: any active staff membership will do.
  const required = pathname === null ? [] : staffRoutePermissions(pathname);
  try {
    const ctx = await requireStaffContext();
    if (required === undefined || !hasAnyPermission(ctx, required)) throw new AuthError("FORBIDDEN");
    return ctx;
  } catch (err) {
    if (isAuthError(err) && err.code === "NO_MEMBERSHIP") {
      // Not a member (yet): someone with a pending invitation — e.g. a new invitee
      // who just set their password — goes to accept it; a patient goes to the portal.
      const destination = await noMembershipRedirect();
      if (destination) redirect(destination);
    }
    // A self-registered login (no application account until a clinic code is redeemed).
    if (isAuthError(err) && err.code === "NOT_PROVISIONED") redirect(LINK_ACCOUNT_PATH);
    if (isAuthError(err)) await auditDenied(err, pathname ?? "/dashboard");
    redirectOnAuthError(err, pathname ?? "/dashboard");
  }
}

/** The verified identity summary handed to the client shell (or null in demo mode). */
export function toServerSessionUser(ctx: TenantContext): ServerSessionUser {
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: primaryUserRole(ctx.roles), clinicName: ctx.clinicName };
}

export function toPortalSessionUser(ctx: PatientContext): ServerSessionUser {
  return { userId: ctx.userId, name: ctx.name, email: ctx.email, role: "patient", clinicName: ctx.clinicName };
}

/** Server-layout guard for the patient portal. */
export async function guardPortalRoute(): Promise<PatientContext | null> {
  await connection();
  if (!isSupabaseAuthEnabled()) return null;
  try {
    return await requirePatientContext();
  } catch (err) {
    if (isAuthError(err) && err.code === "NO_MEMBERSHIP") {
      const identity = await requireIdentity().catch(() => null);
      if (identity && homeFor(identity) === "staff") redirect("/dashboard");
    }
    if (isAuthError(err) && err.code === "NOT_PROVISIONED") redirect(LINK_ACCOUNT_PATH);
    if (isAuthError(err)) await auditDenied(err, "/portal");
    redirectOnAuthError(err, "/portal");
  }
}
