// Non-auth API failures raised by server data modules (validation, conflicts).
// Pure module — shared by route handlers and tests.

export type DataErrorCode =
  | "INVALID_INPUT"
  | "CONFLICT"
  | "SLOT_TAKEN"
  | "INVALID_TRANSITION"
  | "INSUFFICIENT_STOCK"
  | "DUPLICATE"
  | "NEEDS_CONFIRMATION"
  | "NOT_CONNECTED"
  // P5: a feature whose database migration hasn't been applied yet.
  | "FEATURE_UNAVAILABLE"
  // P5: the server can't send email (SUPABASE_SECRET_KEY missing/invalid).
  | "EMAIL_NOT_CONFIGURED"
  // Staff directory: the person's phone is shared with another clinic, so it can't be changed here.
  | "PHONE_LOCKED"
  // P5 staff invitations (raised by the app.*_staff_invitation functions).
  | "ALREADY_INVITED"
  | "ALREADY_MEMBER"
  | "ALREADY_PATIENT"
  | "REGISTRATION_IN_USE"
  | "NOT_PENDING"
  | "ALREADY_ACCEPTED"
  | "TOO_MANY_ATTEMPTS"
  | "TOO_SOON"
  | "RATE_LIMITED"
  | "EXPIRED"
  | "REVOKED"
  | "UNAVAILABLE"
  | "DOCTOR_PROFILE_EXISTS"
  | "EMAIL_MISMATCH"
  | "EMAIL_NOT_VERIFIED"
  // P6.2 patient documents and lab reports.
  | "UNSUPPORTED_FILE"
  | "FILE_TOO_LARGE"
  | "GONE"
  | "STORAGE_UNAVAILABLE"
  | "SHARED_LOCKED"
  | "NOT_REVIEWED";

const STATUS: Record<DataErrorCode, number> = {
  INVALID_INPUT: 400,
  CONFLICT: 409,
  SLOT_TAKEN: 409,
  INVALID_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  DUPLICATE: 409,
  NEEDS_CONFIRMATION: 409,
  NOT_CONNECTED: 501,
  FEATURE_UNAVAILABLE: 503,
  EMAIL_NOT_CONFIGURED: 503,
  PHONE_LOCKED: 409,
  ALREADY_INVITED: 409,
  ALREADY_MEMBER: 409,
  ALREADY_PATIENT: 409,
  REGISTRATION_IN_USE: 409,
  NOT_PENDING: 409,
  ALREADY_ACCEPTED: 409,
  TOO_MANY_ATTEMPTS: 409,
  TOO_SOON: 429,
  RATE_LIMITED: 429,
  EXPIRED: 409,
  REVOKED: 409,
  UNAVAILABLE: 409,
  DOCTOR_PROFILE_EXISTS: 409,
  EMAIL_MISMATCH: 403,
  EMAIL_NOT_VERIFIED: 403,
  UNSUPPORTED_FILE: 415,
  FILE_TOO_LARGE: 413,
  GONE: 410,
  STORAGE_UNAVAILABLE: 503,
  SHARED_LOCKED: 409,
  NOT_REVIEWED: 409,
};

export class DataError extends Error {
  readonly code: DataErrorCode;
  readonly status: number;
  /** Small, non-sensitive structured context for the client (e.g. the conflicting record). */
  readonly details?: unknown;

  constructor(code: DataErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}
