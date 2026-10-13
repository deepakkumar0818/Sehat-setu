import { ApiRequestError } from "@/lib/api-client";
import type { DeliveryState, InvitableRole, InvitationState } from "@/lib/live-types";
import type { StatusTone } from "@/components/shared/status-badge";

export const INVITATIONS_NOT_READY =
  "Staff invitations aren't set up on this clinic database yet — a database update (migration) still has to be applied. No invitation was created and no email was sent.";

/**
 * What to tell the user when sending an invitation fails. Server errors carry a
 * safe message (and per-field details for validation); anything else is an
 * unexpected browser-side failure, which is never shown raw.
 */
export function inviteErrorMessage(error: unknown): { message: string; fields: string[] } {
  if (error instanceof ApiRequestError) {
    if (error.code === "FEATURE_UNAVAILABLE") return { message: INVITATIONS_NOT_READY, fields: [] };
    const fields = Array.isArray(error.details) ? (error.details as { message?: unknown }[]).map((d) => String(d?.message ?? "")).filter(Boolean) : [];
    return { message: error.message, fields };
  }
  return {
    message: "Something went wrong in this page before the invitation could be sent. Reload the page and try again — no invitation was created.",
    fields: [],
  };
}

export const ROLE_LABEL: Record<InvitableRole, string> = {
  DOCTOR: "Doctor",
  CLINIC_MANAGER: "Clinic Manager",
  RECEPTIONIST: "Receptionist",
  NURSE: "Nurse",
};

export const STATE_BADGE: Record<InvitationState, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
};

export const DELIVERY_BADGE: Record<DeliveryState, { label: string; tone: StatusTone }> = {
  not_sent: { label: "Not sent", tone: "neutral" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Email sent", tone: "success" },
  failed: { label: "Delivery failed", tone: "danger" },
  unknown: { label: "Delivery unknown", tone: "warning" },
};

/** Plain-language reasons for the stored delivery codes (no provider text is ever stored). */
export const DELIVERY_ERROR_TEXT: Record<string, string> = {
  not_configured: "email sending isn't configured on the server yet — SUPABASE_SECRET_KEY is missing or invalid in the server environment (.env.local); add it and restart the server, then resend",
  key_rejected: "Supabase rejected the server's key — check that SUPABASE_SECRET_KEY is this project's current secret key",
  email_disabled: "email sign-in is turned off in the Supabase project (Authentication → Sign In / Providers → Email)",
  send_failed: "Supabase couldn't send the email — check the project's SMTP settings and the Invite / Magic Link email templates",
  rate_limited: "the email service is rate-limiting messages — try again shortly",
  unavailable: "the email service couldn't be reached — try again shortly",
  not_authorized: "the email service refused this address",
  provider_error: "the email service refused the request",
  unknown: "the email service returned an unexpected error",
};

/** The short form for a table cell: the reason without its "what to do" part. */
export const deliveryErrorSummary = (code: string) => (DELIVERY_ERROR_TEXT[code] ?? code).split(" — ")[0];
