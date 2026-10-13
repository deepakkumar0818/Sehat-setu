import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { requireIdentity, requireStaff } from "@/server/auth/session";
import { AuthError, isAuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import type { Identity, TenantContext } from "@/server/auth/authorize";

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

/**
 * Like apiRoute, but the handler returns a file (e.g. a CSV export) that the
 * browser downloads. Same session, permission and error handling: failures are
 * still JSON error responses.
 */
export function fileRoute<P extends RouteParams = RouteParams>(
  options: { permission: string | readonly string[]; resource: string },
  handler: (args: { ctx: TenantContext; request: NextRequest; params: P }) => Promise<{ filename: string; contentType: string; body: string }>
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      const ctx = await requireStaff(options.permission, options.resource);
      const file = await handler({ ctx, request, params: await context.params });
      const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, "_");
      return new NextResponse(file.body, {
        headers: {
          ...NO_STORE,
          "Content-Type": file.contentType,
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
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
  console.error(`[api] ${resource}`, err);
  return errorResponse(500, "INTERNAL", "Something went wrong. Please try again.");
}

/** Query-string params as a plain object (repeated keys keep the last value). */
export function searchParamsOf(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}
