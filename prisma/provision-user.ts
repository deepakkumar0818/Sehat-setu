// Provisions an application user + clinic membership, ready to be invited.
// Creates NO login credentials: the person gets access only after an admin
// sends a Supabase Auth invitation to the same email and they set their own
// password. On first sign-in the server links the two by confirmed email.
//
//   npm run auth:provision -- --email you@yourclinic.com --name "Your Name" --clinic AAR --role ADMINISTRATOR
//   npm run auth:provision -- --email nurse@yourclinic.com --name "A Nurse" --clinic AAR --role NURSE --branch WKD
//   npm run auth:provision -- --email p@example.com --name "A Patient" --clinic AAR --role PATIENT --patient AAR-P-0007
//
// --patient links an existing patient record to this user for the patient
// portal. It only fills an EMPTY link and refuses if the record already
// belongs to someone else. Every run is written to the audit trail.
//
// Idempotent: re-running for the same email/clinic/role changes nothing.
import { createScriptClient } from "./seed/connect";

const ROLES = ["ADMINISTRATOR", "CLINIC_MANAGER", "DOCTOR", "RECEPTIONIST", "NURSE", "PATIENT"] as const;
type Role = (typeof ROLES)[number];

export function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const email = get("--email")?.trim().toLowerCase();
  const name = get("--name")?.trim();
  const clinicCode = get("--clinic")?.trim().toUpperCase();
  const role = get("--role")?.trim().toUpperCase() as Role | undefined;
  const branchCode = get("--branch")?.trim().toUpperCase();
  const phone = get("--phone")?.trim();
  const patientNumber = get("--patient")?.trim().toUpperCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email is required and must be a valid address.");
  if (!name) throw new Error("--name is required.");
  if (!clinicCode) throw new Error("--clinic <CODE> is required (e.g. AAR).");
  if (!role || !ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(", ")}.`);
  if (patientNumber && role !== "PATIENT") throw new Error("--patient can only be used with --role PATIENT.");
  if (role === "PATIENT" && !patientNumber) throw new Error("--role PATIENT needs --patient <patient number> to link their record.");
  return { email, name, clinicCode, role, branchCode, phone, patientNumber };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = createScriptClient(); // admin connection (DIRECT_URL); provisioning is an operator action
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Attributes the audit rows written by triggers in this transaction.
      await tx.$executeRaw`SELECT set_config('app.actor_label', 'cli:auth:provision', true)`;
      const clinic = await tx.clinic.findUnique({ where: { code: args.clinicCode } });
      if (!clinic) throw new Error(`No clinic with code ${args.clinicCode}.`);
      const role = await tx.role.findUnique({ where: { key: args.role } });
      if (!role) throw new Error(`Role ${args.role} is missing — run the seed first.`);
      let branchId: string | null = null;
      if (args.branchCode) {
        const branch = await tx.branch.findUnique({ where: { clinicId_code: { clinicId: clinic.id, code: args.branchCode } } });
        if (!branch) throw new Error(`Clinic ${args.clinicCode} has no branch ${args.branchCode}.`);
        branchId = branch.id;
      }

      const existing = await tx.user.findUnique({ where: { email: args.email } });
      const user =
        existing ??
        (await tx.user.create({ data: { email: args.email, name: args.name, phone: args.phone, status: "INVITED" } }));

      const membership = await tx.clinicMembership.findUnique({
        where: { userId_clinicId_roleId: { userId: user.id, clinicId: clinic.id, roleId: role.id } },
      });
      if (!membership) {
        await tx.clinicMembership.create({ data: { userId: user.id, clinicId: clinic.id, branchId, roleId: role.id, status: "ACTIVE" } });
      }
      let patientLinked = false;
      if (args.patientNumber) {
        const patient = await tx.patient.findUnique({ where: { clinicId_patientNumber: { clinicId: clinic.id, patientNumber: args.patientNumber } } });
        if (!patient) throw new Error(`Clinic ${args.clinicCode} has no patient ${args.patientNumber}.`);
        if (patient.userId && patient.userId !== user.id) throw new Error(`Patient ${args.patientNumber} is already linked to another account.`);
        if (!patient.userId) {
          await tx.patient.update({ where: { id: patient.id }, data: { userId: user.id } });
          patientLinked = true;
        }
      }

      await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinic.id}, true)`;
      await tx.$executeRaw`SELECT app.log_event('user.provisioned', 'SUCCESS', 'user', ${user.id}, NULL, 'cli:auth:provision', NULL,
        ${JSON.stringify({ role: args.role, branch: args.branchCode ?? null, patientLinked })}::jsonb)`;
      return { createdUser: !existing, createdMembership: !membership, linked: Boolean(user.authProviderId), clinicName: clinic.name, patientLinked };
    });

    console.log(`${result.createdUser ? "Created" : "Found existing"} user ${args.email}.`);
    console.log(`${result.createdMembership ? "Added" : "Already had"} ${args.role} membership at ${result.clinicName}${args.branchCode ? ` (branch ${args.branchCode} only)` : ""}.`);
    if (result.patientLinked) console.log(`Linked patient record ${args.patientNumber} to this account.`);
    if (result.linked) {
      console.log("This user is already linked to a Supabase login — no invitation needed.");
    } else {
      console.log("Next: Supabase Dashboard → Authentication → Users → Invite user, using this exact email.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/provision-user.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
