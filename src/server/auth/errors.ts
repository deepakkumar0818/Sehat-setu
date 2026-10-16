// Typed authentication/authorization failures. Pure module (no server-only
// imports) so it can be shared by route handlers, layouts, and tests.

export type AuthErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "NOT_PROVISIONED"
  | "ACCOUNT_DISABLED"
  | "NO_MEMBERSHIP"
  | "CLINIC_FORBIDDEN"
  | "MULTIPLE_BRANCH_SCOPES"
  | "FORBIDDEN"
  | "BRANCH_FORBIDDEN"
  // P6.3: a PATIENT membership exists but no patient record is linked to the account (yet, or any more).
  | "PATIENT_NOT_LINKED"
  | "NOT_FOUND";

const STATUS: Record<AuthErrorCode, number> = {
  AUTH_NOT_CONFIGURED: 503,
  AUTH_UNAVAILABLE: 503,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  NOT_PROVISIONED: 403,
  ACCOUNT_DISABLED: 403,
  NO_MEMBERSHIP: 403,
  CLINIC_FORBIDDEN: 403,
  MULTIPLE_BRANCH_SCOPES: 403,
  FORBIDDEN: 403,
  BRANCH_FORBIDDEN: 403,
  PATIENT_NOT_LINKED: 403,
  // Records in another clinic are reported as missing, not forbidden, so
  // their existence isn't revealed.
  NOT_FOUND: 404,
};

const MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_NOT_CONFIGURED: "Authentication is not configured on this server.",
  AUTH_UNAVAILABLE: "The authentication service is temporarily unavailable. Please try again.",
  UNAUTHENTICATED: "Please sign in to continue.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  NOT_PROVISIONED: "Your sign-in works, but it isn't connected to a clinic yet. Patients: finish setting up your account, or enter the linking code your clinic gave you. Staff: ask your clinic administrator for an invitation.",
  ACCOUNT_DISABLED: "This account has been disabled.",
  NO_MEMBERSHIP: "Your account isn't an active member of any clinic.",
  CLINIC_FORBIDDEN: "You don't have access to that clinic.",
  MULTIPLE_BRANCH_SCOPES: "Your memberships restrict you to different branches; ask an administrator to adjust them.",
  FORBIDDEN: "You don't have permission to do that.",
  BRANCH_FORBIDDEN: "That record belongs to a branch you don't have access to.",
  // Deliberately generic: says nothing about whether any patient record exists for this person.
  PATIENT_NOT_LINKED: "Your patient portal account isn't connected to your clinic records yet. Enter the linking code your clinic gave you, or contact your clinic to complete the setup.",
  NOT_FOUND: "Not found.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

export function authErrorMessage(code: string | null | undefined): string | undefined {
  return code && code in MESSAGES ? MESSAGES[code as AuthErrorCode] : undefined;
}
