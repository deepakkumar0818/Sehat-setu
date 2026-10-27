import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { requireIdentity, requirePatient, requirePlatformAdmin, requireStaff } from "@/server/auth/session";
import { AuthError, isAuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { errorText } from "@/server/data/document-rules";
import { planLimitMessage } from "@/server/data/platform-rules";
import { logServerError } from "@/server/log";
import { reportServerError } from "@/server/monitoring";
import type { Identity, PatientContext, TenantContext } from "@/server/auth/authorize";

// Every /api/v1 route goes through apiRoute(): it verifies the Supabase
// session, resolves the clinic/branch-scoped TenantContext, enforces the
// route's permission (any-of), and maps failures to JSON errors. There is no
// fallback: an error is an error response, never mock data.

type RouteParams = Record<string, string>;
type Handler<P extends RouteParams> = (args: { ctx: TenantContext; request: NextRequest; params: P }) => Promise<unknown>;

const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status, headers: NO_STORE });
}

export function apiRoute<P extends RouteParams = RouteParams>(
  options: { permission: string | readonly string[]; resource: string },
  handler: Handler<P>
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await requireStaff(options.permission, options.resource);
      const result = await handler({ ctx, request, params: await context.params });
      return NextResponse.json(result ?? null, { headers: NO_STORE });
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

export interface FileResult {
  filename: string;
  contentType: string;
  body: string | Uint8Array;
  /** Default "attachment". "inline" only for content that is safe to render (images). */
  disposition?: "inline" | "attachment";
}

/** A file response with the headers every download uses (private, no-store, nosniff, sandboxed). */
function fileResponse(file: FileResult) {
  const safeName = file.filename.normalize("NFKD").replace(/[^A-Za-z0-9._-]/g, "_");
  // Non-ASCII names (e.g. Devanagari) also get an RFC 5987 filename*, itself stripped of separators, quotes and control characters.
  const unicodeName = file.filename.replace(/[\\/"\u0000-\u001f\u007f-\u009f]/g, "_");
  const extended = /[^\x20-\x7e]/.test(unicodeName) ? `; filename*=UTF-8''${encodeURIComponent(unicodeName)}` : "";
  const body = typeof file.body === "string" ? new TextEncoder().encode(file.body) : file.body;
  return new NextResponse(new Blob([body as BlobPart]), {
    headers: {
      ...NO_STORE,
      "Content-Type": file.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${file.disposition ?? "attachment"}; filename="${safeName}"${extended}`,
      "X-Content-Type-Options": "nosniff",
      // Never let a served file run script or load anything, even if a browser renders it.
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Like apiRoute, but the handler returns a file (e.g. a CSV export) that the
 * browser downloads. Same session, permission and error handling: failures are
 * still JSON error responses.
 */
export function fileRoute<P extends RouteParams = RouteParams>(
  options: { permission: string | readonly string[]; resource: string },
  handler: (args: { ctx: TenantContext; request: NextRequest; params: P }) => Promise<FileResult>
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await requireStaff(options.permission, options.resource);
      return fileResponse(await handler({ ctx, request, params: await context.params }));
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

/** For /api/v1/platform/*: an active Sehat Setu super admin (no clinic context; the database re-checks). */
export function platformRoute<P extends RouteParams = RouteParams>(
  options: { resource: string },
  handler: (args: { identity: Identity; request: NextRequest; params: P }) => Promise<unknown>
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const identity = await requirePlatformAdmin(options.resource);
      const result = await handler({ identity, request, params: await context.params });
      return NextResponse.json(result ?? null, { headers: NO_STORE });
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

type PatientHandler<P extends RouteParams, T> = (args: { ctx: PatientContext; request: NextRequest; params: P }) => Promise<T>;

/**
 * For /api/v1/portal/* (P6.3): a verified patient-portal session whose patient
 * record ids come only from the server-side link. Staff memberships never grant
 * anything here, and the database scopes every read to app.current_patient_ids().
 */
export function patientRoute<P extends RouteParams = RouteParams>(options: { resource: string }, handler: PatientHandler<P, unknown>) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await requirePatient(options.resource);
      const result = await handler({ ctx, request, params: await context.params });
      return NextResponse.json(result ?? null, { headers: NO_STORE });
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

/** patientRoute for a file download (same headers as staff downloads). */
export function patientFileRoute<P extends RouteParams = RouteParams>(options: { resource: string }, handler: PatientHandler<P, FileResult>) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await requirePatient(options.resource);
      return fileResponse(await handler({ ctx, request, params: await context.params }));
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

type IdentityHandler<P extends RouteParams> = (args: { identity: VerifiedIdentity; request: NextRequest; params: P }) => Promise<unknown>;

/** A verified, linked, ACTIVE user with a Supabase-confirmed email (they may belong to no clinic yet). */
export type VerifiedIdentity = Identity & { verifiedEmail: string };

/**
 * For the few /api/v1/me/* endpoints a signed-in user needs BEFORE they belong
 * to a clinic (pending staff invitations). Verifies the Supabase session and
 * the linked account, and requires a confirmed email; no clinic scope is
 * resolved, so handlers must check ownership themselves (the database
 * functions they call do).
 */
export function identityRoute<P extends RouteParams = RouteParams>(options: { resource: string }, handler: IdentityHandler<P>) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const identity = await requireIdentity();
      if (identity.status !== "ACTIVE") throw new AuthError("ACCOUNT_DISABLED");
      if (!identity.verifiedEmail) throw new DataError("EMAIL_NOT_VERIFIED", "Confirm your email address, then sign in again.");
      const result = await handler({ identity: identity as VerifiedIdentity, request, params: await context.params });
      return NextResponse.json(result ?? null, { headers: NO_STORE });
    } catch (err) {
      return toErrorResponse(err, options.resource);
    }
  };
}

function toErrorResponse(err: unknown, resource: string) {
  if (isAuthError(err)) return errorResponse(err.status, err.code, err.message);
  if (err instanceof DataError) return errorResponse(err.status, err.code, err.message, err.details);
  if (err instanceof SyntaxError) return errorResponse(400, "INVALID_INPUT", "The request body isn't valid JSON.");
  if (err instanceof ZodError) {
    return errorResponse(400, "INVALID_INPUT", "Some fields are missing or invalid.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2002") {
    return errorResponse(409, "CONFLICT", "That record already exists.");
  }
  // Raised by the plan-limit triggers (migration 20261104000000_platform_subscriptions).
  const planLimit = planLimitMessage(errorText(err));
  if (planLimit) return errorResponse(409, "PLAN_LIMIT", planLimit);
  logServerError(`api ${resource}`, err); // codes only: never row data, messages of database errors or secrets
  reportServerError(`api ${resource}`, err);
  return errorResponse(500, "INTERNAL", "Something went wrong. Please try again.");
}

/** Query-string params as a plain object (repeated keys keep the last value). */
export function searchParamsOf(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}
