// Server error logging that can't leak patient data or secrets.
//
// Database and Prisma errors routinely carry row contents: PostgreSQL's
// "Failing row contains (…)" and "Key (email)=(…) already exists" details,
// Prisma validation errors that echo the query arguments, raw-query errors
// that embed the SQL message. Logging the error object (or its message)
// therefore puts names, phone numbers, emails and clinical values into the
// hosting provider's logs. Only the fields below are ever logged:
//
//   * the error's class name and machine-readable codes (Prisma P-codes,
//     PostgreSQL SQLSTATE, Node/network codes),
//   * Prisma's model name and the NAMES of the fields in a unique-constraint
//     failure (never their values),
//   * a message only for non-database errors, after redaction, truncated,
//   * the first few stack frames (code locations only).
//
// Pure module (no "server-only") so it is unit-tested directly.

const MAX_MESSAGE = 160;
const MAX_FRAMES = 4;

/** Error classes whose messages may embed data: their messages are never logged. */
const DATA_BEARING = /^(PrismaClient\w*Error|DatabaseError|DriverAdapterError|PostgresError|QueryFailedError)$/;

const REDACTIONS: [RegExp, string][] = [
  [/(postgres(?:ql)?|mysql|https?):\/\/[^\s/@]+:[^\s@]+@/gi, "$1://<credentials>@"], // credentials in URLs
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<supabase-key>"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "<jwt>"],
  [/\b(?:Bearer|token|apikey|password|secret)\b\s*[:=]?\s*\S+/gi, "<secret>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>"],
  [/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi, "<ip>"],
  [/\+?\d[\d\s-]{6,}\d/g, "<number>"], // phone numbers, ids, amounts
  [/"[^"]*"|'[^']*'|`[^`]*`/g, "<value>"], // quoted values
];

export function redact(text: string): string {
  let out = text;
  for (const [re, by] of REDACTIONS) out = out.replace(re, by);
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

type Summary = Record<string, string | number | string[]>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,40}$/.test(v) ? v : undefined;
}

/** The loggable, data-free summary of an error. */
export function errorSummary(err: unknown): Summary {
  if (!(err instanceof Error)) return { kind: typeof err };
  const e = err as Error & { code?: unknown; meta?: Record<string, unknown>; cause?: unknown; clientVersion?: unknown };
  const out: Summary = { kind: e.name || "Error" };
  const code = str(e.code);
  if (code) out.code = code;
  const meta = e.meta && typeof e.meta === "object" ? e.meta : undefined;
  if (meta) {
    const model = str(meta.modelName);
    if (model) out.model = model;
    // Unique-constraint failures: the field NAMES only (Prisma puts names here, never values).
    const target = meta.target;
    if (Array.isArray(target)) out.fields = target.filter((t): t is string => typeof t === "string" && /^[A-Za-z0-9_]{1,64}$/.test(t)).slice(0, 8);
    else if (str(target)) out.fields = [target as string];
    const sqlState = str(meta.code);
    if (sqlState) out.sqlState = sqlState;
    // Driver adapter errors nest the PostgreSQL error: keep only its codes.
    const driver = meta.driverAdapterError as { cause?: { originalCode?: unknown; kind?: unknown } } | undefined;
    const original = str(driver?.cause?.originalCode);
    if (original) out.sqlState = original;
  }
  const causeCode = str((e.cause as { code?: unknown } | undefined)?.code);
  if (causeCode && !out.code) out.code = causeCode;
  if (!DATA_BEARING.test(out.kind as string) && !meta) out.message = redact(e.message ?? "");
  const frames = (e.stack ?? "").split("\n").filter((l) => /^\s+at /.test(l)).slice(0, MAX_FRAMES).map((l) => redact(l.trim()));
  if (frames.length) out.at = frames;
  return out;
}

/** Logs an unexpected server error without its data. Never throws. */
export function logServerError(scope: string, err: unknown): void {
  const label = redact(scope.replace(/\s+/g, " ")).replace(/[^\w ./[\]:<>-]/g, "").slice(0, 120);
  try {
    console.error(`[${label}]`, JSON.stringify(errorSummary(err)));
  } catch {
    console.error(`[${label}] (unloggable error)`);
  }
}
