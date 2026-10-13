// Read-only database check: connectivity, existing public tables, migration
// state, and row counts for Sehat Setu's tables. Never writes anything.
//
//   npm run db:status
import { createScriptClient } from "./seed/connect";

async function main() {
  const prisma = createScriptClient();
  try {
    const [info] = await prisma.$queryRaw<{ user: string; version: string; bypass_rls: boolean }[]>`
      SELECT current_user AS "user",
             current_setting('server_version') AS version,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls`;
    console.log(`Connected as "${info.user}" (PostgreSQL ${info.version}). BYPASSRLS: ${info.bypass_rls}`);

    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    const names = new Set(tables.map((t) => t.table_name));
    console.log(`Tables in public schema: ${names.size ? [...names].join(", ") : "(none)"}`);

    if (names.has("_prisma_migrations")) {
      const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`;
      for (const m of migrations) {
        const state = m.rolled_back_at ? "failed attempt, rolled back" : m.finished_at ? "applied" : "NOT finished";
        console.log(`Migration ${m.migration_name}: ${state}`);
      }
    } else {
      console.log("No Prisma migrations applied yet.");
    }

    if (!names.has("clinics")) return;
    const counts = {
      clinics: await prisma.clinic.count(),
      branches: await prisma.branch.count(),
      departments: await prisma.department.count(),
      users: await prisma.user.count(),
      doctors: await prisma.doctorProfile.count(),
      staffMemberships: await prisma.clinicMembership.count({ where: { role: { key: { not: "DOCTOR" } } } }),
      patients: await prisma.patient.count(),
      appointments: await prisma.appointment.count(),
      consultations: await prisma.consultation.count(),
      prescriptions: await prisma.prescription.count(),
      medicines: await prisma.medicine.count(),
      invoices: await prisma.invoice.count(),
      payments: await prisma.payment.count(),
    };
    console.table(counts);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
