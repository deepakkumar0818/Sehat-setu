import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorSummary, logServerError, redact } from "./log";

// Server error logs must never contain patient data, contact details, row
// contents or secrets. Fixtures below are fictional ("ZZTEST").

const PHONE = "+919800000001";
const EMAIL = "zztest.patient@example.com";

/** Shapes of real errors that carry data (PostgreSQL / Prisma / driver adapter). */
function pgCheckViolation() {
  return Object.assign(new Error(`new row for relation "patients" violates check constraint "patients_phone_e164"\nDETAIL: Failing row contains (5e1c, ZZTEST Patient, ${PHONE}, ${EMAIL}, diabetes).`), {
    name: "DatabaseError",
    code: "23514",
  });
}
function prismaKnown() {
  return Object.assign(new Error(`Invalid \`prisma.patient.create()\` invocation:\n\nUnique constraint failed on the fields: (\`clinicId\`,\`phone\`) value ${PHONE}`), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    clientVersion: "7.10.0",
    meta: { modelName: "Patient", target: ["clinicId", "phone"] },
  });
}
function prismaRawQuery() {
  return Object.assign(new Error(`Raw query failed. Code: \`23505\`. Message: \`Key (email)=(${EMAIL}) already exists.\``), {
    name: "PrismaClientKnownRequestError",
    code: "P2010",
    meta: { code: "23505", message: `Key (email)=(${EMAIL}) already exists.` },
  });
}
function prismaValidation() {
  return Object.assign(new Error(`Argument \`name\`: Invalid value provided. Expected String, provided ... { name: "ZZTEST Patient", phone: "${PHONE}", allergies: ["penicillin"] }`), {
    name: "PrismaClientValidationError",
  });
}

const leaks = (s: string) => [PHONE, EMAIL, "ZZTEST", "penicillin", "diabetes", "9800000001"].filter((x) => s.includes(x));

afterEach(() => vi.restoreAllMocks());

describe("errorSummary: codes, never data", () => {
  it.each([
    ["PostgreSQL check violation (Failing row contains …)", pgCheckViolation()],
    ["Prisma unique violation", prismaKnown()],
    ["Prisma raw query error (Key (email)=(…))", prismaRawQuery()],
    ["Prisma validation error (echoes arguments)", prismaValidation()],
  ])("%s", (_label, err) => {
    const out = JSON.stringify(errorSummary(err));
    expect(leaks(out), out).toEqual([]);
    expect(out).not.toMatch(/Failing row|DETAIL|Key \(/);
  });

  it("keeps what an operator needs: class, Prisma code, SQLSTATE, model and field NAMES, code locations", () => {
    expect(errorSummary(prismaKnown())).toMatchObject({ kind: "PrismaClientKnownRequestError", code: "P2002", model: "Patient", fields: ["clinicId", "phone"] });
    expect(errorSummary(prismaRawQuery())).toMatchObject({ code: "P2010", sqlState: "23505" });
    expect(errorSummary(pgCheckViolation())).toMatchObject({ kind: "DatabaseError", code: "23514" });
    expect(errorSummary(pgCheckViolation())).not.toHaveProperty("message");
    expect(errorSummary(new TypeError("Cannot read properties of undefined (reading 'id')")).at).toBeDefined();
  });

  it("redacts an ordinary error's message and truncates it", () => {
    const s = errorSummary(new Error(`lookup failed for ${EMAIL} / ${PHONE} with "ZZTEST Patient"`));
    expect(s.message).toBe("lookup failed for <email> / <number> with <value>");
    expect(String(errorSummary(new Error("x".repeat(500))).message).length).toBeLessThanOrEqual(161);
  });

  it("redacts secrets: credentials in URLs, Supabase keys, JWTs, tokens", () => {
    const text = redact(
      "connect postgresql://postgres:hunter2pass@db.example.co:5432/postgres failed; key sb_secret_AbCdEf123456 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig password=hunter2"
    );
    expect(text).not.toMatch(/hunter2|AbCdEf123456|eyJhbGci/);
    expect(text).toContain("<credentials>");
  });

  it("handles non-Error values", () => {
    expect(errorSummary("a string with " + EMAIL)).toEqual({ kind: "string" });
    expect(errorSummary(null)).toEqual({ kind: "object" });
  });
});

describe("logServerError", () => {
  it("writes one line: a sanitised scope and the data-free summary", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logServerError(`api POST /api/v1/patients\n${EMAIL}`, prismaValidation());
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(spy.mock.calls[0]);
    expect(leaks(line), line).toEqual([]);
    expect(line).toContain("[api POST /api/v1/patients <email>]");
    expect(line).toContain("PrismaClientValidationError");
  });
});

describe("server code logs errors only through the safe logger", () => {
  const SRC = path.resolve(import.meta.dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const f = path.join(dir, e);
      if (statSync(f).isDirectory()) return e === "generated" ? [] : files(f);
      return /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [f] : [];
    });

  it("no server module or route passes a raw error object or error message to console.*", () => {
    const offenders: string[] = [];
    for (const f of [...files(path.join(SRC, "server")), ...files(path.join(SRC, "app"))]) {
      if (path.relative(SRC, f).replaceAll(path.sep, "/") === "server/log.ts") continue; // the logger itself
      const src = readFileSync(f, "utf8");
      if (/^\s*["']use client["']/.test(src)) continue;
      for (const m of src.matchAll(/console\.(error|warn|log|info)\(([^;]*)\);/g)) {
        // Allowed: codes/names/operations only. Forbidden: a bare error, its message, or its stack.
        if (/(^|[,(\s])(err|error|e)\s*(\)|,|$)|\.(message|stack)\b(?![\s\S]*\?\?)/.test(m[2]) && !/\b(code|name|operation)\b/.test(m[2])) {
          offenders.push(`${path.relative(SRC, f)}: console.${m[1]}(${m[2].slice(0, 60)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the API, auth and audit error paths use logServerError", () => {
    expect(readFileSync(path.join(SRC, "server/api/route-handler.ts"), "utf8")).toMatch(/logServerError\(`api \$\{resource\}`, err\)/);
    expect(readFileSync(path.join(SRC, "server/auth/http.ts"), "utf8")).toMatch(/logServerError\("auth", err\)/);
    expect(readFileSync(path.join(SRC, "server/audit.ts"), "utf8")).toMatch(/logServerError\(`audit \$\{event\.action\}`, err\)/);
  });
});
