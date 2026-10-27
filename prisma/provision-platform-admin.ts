// Makes someone a Sehat Setu super admin (the /platform console: every clinic,
// adding clinics, suspending them). Operator-only: it uses the admin database
// connection and the Supabase secret key, and is never run by the app.
//
//   npm run auth:platform-admin -- --email superadmin@example.com --name "Super Admin"
//   npm run auth:platform-admin -- --email superadmin@example.com --name "Super Admin" --create-login
//
// Without --create-login it only grants the role: the person signs in with an
// existing login for that email (or one you invite from the Supabase dashboard).
// With --create-login it also creates a confirmed Supabase login with a random
// password, printed ONCE here: change it after the first sign-in. It never
// changes the password of a login that already exists.
//
// Idempotent; every run is written to the audit trail.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createScriptClient } from "./seed/connect";

export function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = get("--email")?.trim().toLowerCase();
  const name = get("--name")?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email is required and must be a valid address.");
  if (!name || name.length < 2) throw new Error("--name is required.");
  return { email, name, createLogin: argv.includes("--create-login") };
}

/** 20 characters from an unambiguous alphabet, always with a digit, a letter of each case and a symbol. */
export function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*!?"];
  const all = sets.join("");
  const pick = (s: string) => s[randomBytes(1)[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 16 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = createScriptClient();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.actor_label', 'cli:auth:platform-admin', true)`;
      const existing = await tx.user.findFirst({ where: { email: { equals: args.email, mode: "insensitive" } } });
      if (existing?.status === "DISABLED") throw new Error(`${args.email} is disabled; re-enable it first.`);
      const user = existing ?? (await tx.user.create({ data: { email: args.email, name: args.name, status: "INVITED" } }));
      const rows = await tx.$executeRaw`INSERT INTO platform_admins ("userId") VALUES (${user.id}::uuid) ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`SELECT app.log_event('platform.admin_granted', 'SUCCESS', 'user', ${user.id}, NULL, 'cli:auth:platform-admin', NULL, NULL)`;
      return { created: !existing, granted: rows === 1, linked: Boolean(user.authProviderId) };
    });
    console.log(`${result.created ? "Created" : "Found existing"} user ${args.email}.`);
    console.log(result.granted ? "Granted super admin." : "Already a super admin.");

    if (!args.createLogin) {
      if (!result.linked) console.log("Next: give this email a login (Supabase → Authentication → Invite user), or re-run with --create-login.");
      return;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local to create a login.");
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const password = generatePassword();
    const { error } = await admin.auth.admin.createUser({ email: args.email, password, email_confirm: true });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) {
        console.log("A login for this email already exists; its password was NOT changed. Sign in with it (or use Forgot password).");
        return;
      }
      throw new Error(`Supabase refused to create the login: ${error.message}`);
    }
    console.log("Created a confirmed login. Sign in at /login with:");
    console.log(`  email:    ${args.email}`);
    console.log(`  password: ${password}`);
    console.log("This password is shown only now. Change it after the first sign-in (Settings → Change password).");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/provision-platform-admin.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
