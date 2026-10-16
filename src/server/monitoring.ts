// Provider-neutral monitoring hooks (no third-party SDK, nothing sent anywhere).
//
// Code reports CATEGORISED, SANITISED events; a sink decides where they go:
//   * none (default): events are dropped. Monitoring is NOT active.
//   * console (SEHAT_MONITORING=console): one JSON line per event on stdout,
//     for local development or for a log-based provider that tails stdout.
//   * custom: setMonitoringSink() is the single integration point for a real
//     provider (e.g. registered from src/instrumentation.ts), after approval.
//
// What an event may contain (everything else is dropped):
//   category, severity, scope (a route TEMPLATE or operation name; ids are
//   masked), reason (a machine code such as FORBIDDEN or invalid_credentials),
//   HTTP status, the data-free error summary from ./log (class, Prisma code,
//   SQLSTATE, model/field names, redacted stack frames), and burst counts.
// Never: names, phone numbers, emails, clinical details, user ids, IP
// addresses, passwords, tokens, SQL parameters, request bodies, query strings
// or raw database messages.
//
// Bursts (e.g. many access denials) are also counted here, per server
// instance, and turned into one "alert" event per window. Real alerting must
// aggregate across instances in the provider (thresholds: docs/security.md).
//
// Pure module (no "server-only") so it is unit-tested directly; it is only
// imported by server code.
import { errorSummary, redact } from "./log";

export type MonitorCategory =
  | "server_error"
  | "db_unavailable"
  | "audit_write_failed"
  | "access_denied"
  | "auth_failure"
  | "link_code_failure"
  | "alert";

export type Severity = "info" | "warning" | "error" | "critical";

export interface MonitorEvent {
  category: MonitorCategory;
  severity: Severity;
  /** Route template or operation, e.g. "api GET /api/v1/patients/[id]". */
  scope: string;
  /** Machine-readable reason code. */
  reason?: string;
  status?: number;
  error?: ReturnType<typeof errorSummary>;
  /** Alerts only: which category burst, how many events, over what window. */
  burst?: { category: MonitorCategory; count: number; windowSeconds: number };
  at: string;
}

export interface MonitoringSink {
  readonly name: string;
  capture(event: MonitorEvent): void | Promise<void>;
}

const noopSink: MonitoringSink = { name: "none", capture: () => {} };
export const consoleSink: MonitoringSink = {
  name: "console",
  capture: (event) => console.info(`[monitor] ${JSON.stringify(event)}`),
};

function defaultSink(): MonitoringSink {
  return process.env.SEHAT_MONITORING === "console" ? consoleSink : noopSink;
}

let sink: MonitoringSink | null = null;

/** Integration point for a monitoring provider. Pass null to return to the default (env-selected) sink. */
export function setMonitoringSink(next: MonitoringSink | null): void {
  sink = next;
}

/** Which sink is in use — "none" means nothing is being monitored. */
export function monitoringStatus(): { sink: string; active: boolean } {
  const s = sink ?? defaultSink();
  return { sink: s.name, active: s.name !== "none" };
}

// --- Sanitising ---------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Route templates and operation names only: ids, query strings and anything personal are masked. */
export function sanitizeScope(scope: string): string {
  const noQuery = scope.split(/[?#]/)[0];
  const masked = noQuery.replace(UUID, "[id]").replace(/\/\d{3,}(?=\/|$)/g, "/[id]").replace(/\s+/g, " ");
  return redact(masked).replace(/[^\w ./[\]():<>-]/g, "").slice(0, 120);
}

function sanitizeReason(reason: unknown): string | undefined {
  if (reason === undefined || reason === null) return undefined;
  return typeof reason === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(reason) ? reason : "other";
}

function sanitizeStatus(status: unknown): number | undefined {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

// --- Bursts ---------------------------------------------------------------------

export interface BurstRule {
  count: number;
  windowSeconds: number;
  severity: Severity;
}

/** Per-instance alert thresholds (documented in docs/security.md). */
export const BURST_RULES: Partial<Record<MonitorCategory, BurstRule>> = {
  audit_write_failed: { count: 1, windowSeconds: 300, severity: "critical" }, // any lost audit record
  db_unavailable: { count: 3, windowSeconds: 60, severity: "critical" },
  server_error: { count: 10, windowSeconds: 300, severity: "error" },
  access_denied: { count: 50, windowSeconds: 300, severity: "warning" },
  auth_failure: { count: 20, windowSeconds: 300, severity: "warning" },
  link_code_failure: { count: 15, windowSeconds: 900, severity: "warning" },
};

export class BurstDetector {
  private readonly seen = new Map<MonitorCategory, number[]>();
  private readonly alertedUntil = new Map<MonitorCategory, number>();

  constructor(private readonly rules: Partial<Record<MonitorCategory, BurstRule>> = BURST_RULES) {}

  /** Records one event; returns the alert to raise if this event reaches the threshold (once per window). */
  record(category: MonitorCategory, nowMs: number): { rule: BurstRule; count: number } | null {
    const rule = this.rules[category];
    if (!rule) return null;
    const windowMs = rule.windowSeconds * 1000;
    const times = (this.seen.get(category) ?? []).filter((t) => t > nowMs - windowMs);
    times.push(nowMs);
    // Bounded memory: never keep more timestamps than the threshold needs.
    if (times.length > rule.count) times.splice(0, times.length - rule.count);
    this.seen.set(category, times);
    if (times.length >= rule.count && (this.alertedUntil.get(category) ?? 0) <= nowMs) {
      this.alertedUntil.set(category, nowMs + windowMs);
      return { rule, count: times.length };
    }
    return null;
  }
}

let bursts = new BurstDetector();
let now = () => Date.now();

/** Tests only: a fresh detector and an injectable clock. */
export function resetMonitoringForTests(clock?: () => number): void {
  bursts = new BurstDetector();
  now = clock ?? (() => Date.now());
  sink = null;
}

// --- Reporting ----------------------------------------------------------------------

const DEFAULT_SEVERITY: Record<MonitorCategory, Severity> = {
  server_error: "error",
  db_unavailable: "critical",
  audit_write_failed: "critical",
  access_denied: "info",
  auth_failure: "info",
  link_code_failure: "info",
  alert: "warning",
};

function deliver(event: MonitorEvent): void {
  try {
    const result = (sink ?? defaultSink()).capture(event);
    if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(() => {});
  } catch {
    // Monitoring must never break the request it observes.
  }
}

/**
 * Reports one categorised event. Only the listed fields are kept, each
 * sanitised; extra properties are ignored. Never throws.
 */
export function reportEvent(category: MonitorCategory, fields: { scope: string; reason?: unknown; status?: unknown; error?: unknown; severity?: Severity }): void {
  try {
    const at = new Date(now()).toISOString();
    const event: MonitorEvent = {
      category,
      severity: fields.severity ?? DEFAULT_SEVERITY[category],
      scope: sanitizeScope(String(fields.scope ?? "")),
      at,
    };
    const reason = sanitizeReason(fields.reason);
    if (reason) event.reason = reason;
    const status = sanitizeStatus(fields.status);
    if (status) event.status = status;
    if (fields.error !== undefined) event.error = errorSummary(fields.error);
    deliver(event);

    const burst = bursts.record(category, now());
    if (burst) {
      deliver({
        category: "alert",
        severity: burst.rule.severity,
        scope: `burst ${category}`,
        burst: { category, count: burst.count, windowSeconds: burst.rule.windowSeconds },
        at,
      });
    }
  } catch {
    // never throws
  }
}

/** Database connectivity failures (Prisma P1xxx, pool timeout, network errors, SQLSTATE class 08 / too many connections). */
export function isDatabaseUnavailable(err: unknown): boolean {
  const s = errorSummary(err);
  const code = String(s.code ?? "");
  const sqlState = String(s.sqlState ?? "");
  return (
    /^P10(0[1-2]|08|17)$/.test(code) ||
    code === "P2024" ||
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/.test(code) ||
    /^08/.test(sqlState) ||
    sqlState === "53300" ||
    sqlState === "57P01"
  );
}

/** An unexpected server error: categorised as db_unavailable or server_error. */
export function reportServerError(scope: string, err: unknown, status = 500): void {
  reportEvent(isDatabaseUnavailable(err) ? "db_unavailable" : "server_error", { scope, status, error: err });
}
