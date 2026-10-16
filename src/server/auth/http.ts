import "server-only";
import { NextResponse } from "next/server";
import { isAuthError } from "@/server/auth/errors";
import { logServerError } from "@/server/log";
import { reportServerError } from "@/server/monitoring";

/** Converts an auth failure into a JSON error response; anything else becomes a generic 500 (details stay in server logs). */
export function authErrorResponse(err: unknown): NextResponse {
  if (isAuthError(err)) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  logServerError("auth", err);
  reportServerError("auth", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}
