import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./provision-user";

const migrationsDir = path.resolve(import.meta.dirname, "migrations");
const allSql = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((d) => readFileSync(path.join(migrationsDir, d.name, "migration.sql"), "utf8"))
  .join("\n");

describe("migrations keep every table behind RLS", () => {
  const created = [...allSql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((m) => m[1]);

  it("enables RLS on every table any migration creates", () => {
    expect(created.length).toBeGreaterThan(0);
    for (const table of created) expect(allSql, `${table} has no ENABLE ROW LEVEL SECURITY`).toMatch(new RegExp(`ALTER TABLE "?${table}"? ENABLE ROW LEVEL SECURITY`));
  });

  it("gives every table at least one policy for the runtime role", () => {
    for (const table of created) expect(allSql, `${table} has no policy`).toMatch(new RegExp(`CREATE POLICY \\w+ ON "?${table}"?[\\s\\S]*?TO sehat_app`));
  });

  it("revokes Supabase Data API access and never grants it back", () => {
    expect(allSql).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated");
    expect(allSql).not.toMatch(/GRANT [^;]* TO [^;]*\b(anon|authenticated)\b/);
  });

  it("never gives the runtime role BYPASSRLS, DELETE, or DDL rights", () => {
    expect(allSql).not.toMatch(/sehat_app[^;]*\bBYPASSRLS\b(?<!NOBYPASSRLS)/);
    expect(allSql).not.toMatch(/GRANT [^;]*\bDELETE\b[^;]* TO sehat_app/);
    expect(allSql).not.toMatch(/GRANT [^;]*\b(CREATE|ALL)\b[^;]* TO sehat_app/);
  });

  it("only sets tenant context transaction-locally", () => {
    const tenantTs = readFileSync(path.resolve(import.meta.dirname, "../src/server/db/tenant.ts"), "utf8");
    const calls = [...tenantTs.matchAll(/set_config\('app\.[a-z_]+', \$\{[^}]+\}, (true|false)\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) expect(c[1]).toBe("true");
  });
});

describe("provision-user arguments", () => {
  it("validates and normalises input", () => {
    expect(parseArgs(["--email", " Admin@Clinic.COM ", "--name", "A", "--clinic", "aar", "--role", "administrator", "--branch", "wkd"])).toMatchObject({
      email: "admin@clinic.com",
      clinicCode: "AAR",
      role: "ADMINISTRATOR",
      branchCode: "WKD",
    });
    expect(() => parseArgs(["--email", "nope", "--name", "A", "--clinic", "AAR", "--role", "NURSE"])).toThrow(/email/);
    expect(() => parseArgs(["--email", "a@b.co", "--name", "A", "--clinic", "AAR", "--role", "SUPERADMIN"])).toThrow(/role/);
    expect(() => parseArgs(["--email", "a@b.co", "--name", "A", "--clinic", "AAR", "--role", "PATIENT"])).toThrow(/--patient/);
    expect(() => parseArgs(["--email", "a@b.co", "--name", "A", "--clinic", "AAR", "--role", "NURSE", "--patient", "AAR-P-0001"])).toThrow(/only be used/);
    expect(parseArgs(["--email", "a@b.co", "--name", "A", "--clinic", "AAR", "--role", "PATIENT", "--patient", "aar-p-0001"]).patientNumber).toBe("AAR-P-0001");
  });
});

describe("P5 migrations (notifications, staff invitations)", () => {
  const read = (name: string) => readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
  const p5 = ["20261019000000_notifications", "20261019000100_staff_invitations"].map((name) => ({ name, sql: read(name) }));
  /** The SQL outside function bodies and DO blocks ($$ … $$), without comments. */
  const topLevel = (sql: string) => sql.replace(/\$\$[\s\S]*?\$\$/g, "$$…$$").replace(/--[^\n]*/g, "");

  it("change no existing rows: no UPDATE/DELETE/INSERT/TRUNCATE/DROP at the top level", () => {
    for (const { name, sql } of p5) {
      expect(topLevel(sql), name).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|TRUNCATE|DROP)\b/im);
      // ALTER TABLE only to enable RLS on the NEW tables.
      for (const m of topLevel(sql).matchAll(/ALTER TABLE "?(\w+)"? ([^;]+);/g)) {
        expect(m[2], `${name}: ${m[0]}`).toBe("ENABLE ROW LEVEL SECURITY");
        expect(["notifications", "notification_reads", "staff_invitations", "staff_invitation_doctor_details"], m[0]).toContain(m[1]);
      }
    }
  });

  it("grant the runtime role only SELECT, own read receipts and the invitation entry points", () => {
    const grants = p5.flatMap(({ sql }) => [...topLevel(sql).matchAll(/GRANT ([^;]+?) TO sehat_app;/g)].map((m) => m[1].replace(/\s+/g, " ")));
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g, g).toMatch(/^(SELECT ON [\w, ]+|INSERT \("userId", "notificationId"\) ON notification_reads|EXECUTE ON FUNCTION .+)$/);
    }
    expect(grants.join(" ")).not.toMatch(/add_notification|require_inviter|mask_email|notify_/);
  });

  it("every new function pins search_path and is revoked from PUBLIC", () => {
    for (const { name, sql } of p5) {
      for (const m of sql.matchAll(/CREATE FUNCTION (app\.\w+)\(/g)) {
        const header = sql.slice(m.index, sql.indexOf("$$", m.index));
        expect(header, `${name}: ${m[1]}`).toContain("SET search_path = ''");
        const revoked = [...sql.matchAll(/REVOKE ALL ON FUNCTION([^;]*) FROM PUBLIC;/g)].some((r) => r[1].includes(`${m[1]}(`));
        expect(revoked, `${name}: ${m[1]} not revoked from PUBLIC`).toBe(true);
      }
    }
  });

  it("never lets Administrator or Patient be invited, and requires a branch", () => {
    const sql = read("20261019000100_staff_invitations");
    for (const m of sql.matchAll(/ARRAY\[('DOCTOR'[^\]]*)\]/g)) expect(m[1]).not.toMatch(/ADMINISTRATOR|PATIENT/);
    expect(sql).toMatch(/"branchId"\s+UUID NOT NULL/);
    expect(sql).toMatch(/IF p_branch_id IS NULL OR NOT app\.branch_visible\(p_branch_id\)/);
  });

  it("refuses to build the email index over case-insensitive duplicates instead of fixing users", () => {
    const sql = read("20261019000100_staff_invitations");
    const check = sql.indexOf("HAVING pg_catalog.count(*) > 1");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(sql.indexOf("CREATE UNIQUE INDEX users_email_lower_key"));
  });

  it("notifications store no free text (no title/body/message columns)", () => {
    const table = read("20261019000000_notifications").match(/CREATE TABLE "notifications" \(([\s\S]*?)\n\);/)?.[1] ?? "";
    expect(table).toContain('"data"');
    expect(table).not.toMatch(/"(title|body|message|text|patientName)"/);
  });
});
