// Gives the least-privileged runtime role `sehat_app` (created by the
// 20261012000100_rls_and_app_role migration) a login password, and points
// DATABASE_URL in .env.local at it. Migrations keep using DIRECT_URL (postgres).
//
//   npm run db:setup-app-role            # first-time setup; no-op if already done
//   npm run db:setup-app-role -- --rotate  # issue a new password
//
// The password is generated locally and sent to PostgreSQL only as a
// SCRAM-SHA-256 verifier, so the plaintext never appears in SQL or server
// logs. Nothing secret is printed.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createScriptClient } from "./seed/connect";

const ROLE = "sehat_app";
const ENV_FILE = ".env.local";

/** RFC 5802/7677 SCRAM-SHA-256 verifier in PostgreSQL's stored format. */
export function scramSha256Verifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function projectRefFrom(directUrl: string): string {
  // Pooler usernames look like "postgres.<project-ref>".
  const user = decodeURIComponent(new URL(directUrl).username);
  const ref = user.split(".")[1];
  if (!ref) throw new Error("Could not read the Supabase project ref from DIRECT_URL's username.");
  return ref;
}

function setEnvVar(source: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, () => line) : `${source.trimEnd()}\n${line}\n`;
}

async function main() {
  const rotate = process.argv.includes("--rotate");
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error("DIRECT_URL is not set in .env.local.");

  const currentRuntime = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
  if (!rotate && currentRuntime && decodeURIComponent(currentRuntime.username).startsWith(`${ROLE}.`)) {
    console.log(`DATABASE_URL already uses ${ROLE}. Nothing to do (pass --rotate to issue a new password).`);
    return;
  }

  const prisma = createScriptClient(); // connects as postgres via DIRECT_URL
  try {
    const [role] = await prisma.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${ROLE}`;
    if (!role) throw new Error(`Role ${ROLE} does not exist yet. Run \`npm run db:migrate\` first.`);
    if (role.rolbypassrls || role.rolsuper) throw new Error(`Role ${ROLE} has BYPASSRLS or SUPERUSER — refusing to use it.`);

    const password = randomBytes(32).toString("base64url"); // URL-safe: no encoding needed
    const verifier = scramSha256Verifier(password);
    // DDL can't take bind parameters; the verifier is base64 + fixed punctuation only.
    if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) throw new Error("Unexpected verifier format.");
    await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${verifier}'`);

    const runtime = new URL(directUrl);
    runtime.username = `${ROLE}.${projectRefFrom(directUrl)}`;
    runtime.password = password;
    runtime.port = "6543"; // Supavisor transaction mode
    runtime.search = "?pgbouncer=true";
    writeFileSync(ENV_FILE, setEnvVar(readFileSync(ENV_FILE, "utf8"), "DATABASE_URL", runtime.toString()));
    console.log(`${ROLE} can now log in. DATABASE_URL in ${ENV_FILE} now uses ${ROLE} on port 6543 (value not shown).`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/setup-app-role.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
