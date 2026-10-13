import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDatabaseCa, verifiedPgConfig } from "./tls";
import { SUPABASE_ROOT_2021_CA } from "./supabase-root-ca";

const URL_OK = "postgresql://u:p@db.example.com:6543/postgres?pgbouncer=true";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const ROOT = path.resolve(import.meta.dirname, "../../..");

describe("database TLS configuration", () => {
  it("always verifies the certificate and hostname with the pinned CA", () => {
    const cfg = verifiedPgConfig(URL_OK, { DATABASE_CA_CERT: PEM });
    expect(cfg.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("uses the embedded Supabase root CA by default, identical to the certificate the CLI uses", () => {
    expect(loadDatabaseCa({})).toBe(SUPABASE_ROOT_2021_CA);
    const file = readFileSync(path.join(ROOT, "certs/supabase-root-2021-ca.crt"), "utf8");
    const normalise = (s: string) => s.split("\r\n").join("\n").trim();
    expect(normalise(SUPABASE_ROOT_2021_CA)).toBe(normalise(file));
  });

  it("accepts a PEM override from DATABASE_CA_CERT, including escaped newlines", () => {
    const escaped = PEM.split("\n").join("\\n");
    expect(loadDatabaseCa({ DATABASE_CA_CERT: escaped })).toBe(PEM);
  });

  it("fails closed on an invalid CA — no insecure fallback", () => {
    expect(() => loadDatabaseCa({ DATABASE_CA_CERT: "not a cert" })).toThrow(/PEM/);
  });

  it("rejects URLs whose ssl parameters could override verification", () => {
    for (const p of ["sslmode=disable", "sslmode=no-verify", "sslrootcert=x", "ssl=false"]) {
      expect(() => verifiedPgConfig(`${URL_OK}&${p}`, { DATABASE_CA_CERT: PEM })).toThrow(/Remove/);
    }
  });

  it("never disables certificate validation anywhere in the codebase", () => {
    const pattern = /rejectUnauthorized\s*:\s*false|sslmode=(disable|no-verify)|sslaccept=accept_invalid_certs/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (!["node_modules", ".next", "generated"].includes(name)) walk(full);
        } else if (/\.(ts|tsx|mts|js)$/.test(name) && !full.endsWith("tls.test.ts") && pattern.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    walk(path.join(ROOT, "prisma"));
    if (pattern.test(readFileSync(path.join(ROOT, "prisma.config.ts"), "utf8"))) offenders.push("prisma.config.ts");
    expect(offenders).toEqual([]);
  });
});
