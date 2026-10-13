// Seeds the development database with Sehat Setu's fictional demo dataset.
//
//   npm run db:seed
//
// Safe to re-run: every row has a deterministic id (prisma/seed/demo-data.ts)
// and is written with `createMany({ skipDuplicates: true })`, i.e. INSERT ...
// ON CONFLICT DO NOTHING. Existing rows — seeded or not — are never updated or
// deleted; anything already present is simply skipped. All inserts run in one
// transaction, so a failure part-way leaves the database unchanged.
//
// No login accounts are created: users are inserted as INVITED with no
// password and no auth-provider link, so nobody can sign in as them.
import { buildDemoData } from "./seed/demo-data";
import { createScriptClient } from "./seed/connect";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production.");
  }

  const prisma = createScriptClient();
  const data = buildDemoData(new Date());

  try {
    const results = await prisma.$transaction(
      async (tx) => {
        const opts = { skipDuplicates: true } as const;
        // Parent tables first, so every foreign key already exists when referenced.
        await tx.$executeRaw`SELECT set_config('app.actor_label', 'cli:db:seed', true)`;
        const steps: [string, number, () => Promise<{ count: number }>][] = [
          ["clinics", data.clinics.length, () => tx.clinic.createMany({ data: data.clinics, ...opts })],
          ["branches", data.branches.length, () => tx.branch.createMany({ data: data.branches, ...opts })],
          ["specialties", data.specialties.length, () => tx.specialty.createMany({ data: data.specialties, ...opts })],
          ["departments", data.departments.length, () => tx.department.createMany({ data: data.departments, ...opts })],
          ["roles", data.roles.length, () => tx.role.createMany({ data: data.roles, ...opts })],
          ["permissions", data.permissions.length, () => tx.permission.createMany({ data: data.permissions, ...opts })],
          ["role_permissions", data.rolePermissions.length, () => tx.rolePermission.createMany({ data: data.rolePermissions, ...opts })],
          ["users", data.users.length, () => tx.user.createMany({ data: data.users, ...opts })],
          ["clinic_memberships", data.memberships.length, () => tx.clinicMembership.createMany({ data: data.memberships, ...opts })],
          ["doctor_profiles", data.doctorProfiles.length, () => tx.doctorProfile.createMany({ data: data.doctorProfiles, ...opts })],
          ["doctor_branches", data.doctorBranches.length, () => tx.doctorBranch.createMany({ data: data.doctorBranches, ...opts })],
          ["patients", data.patients.length, () => tx.patient.createMany({ data: data.patients, ...opts })],
          ["medicines", data.medicines.length, () => tx.medicine.createMany({ data: data.medicines, ...opts })],
          ["appointments", data.appointments.length, () => tx.appointment.createMany({ data: data.appointments, ...opts })],
          ["consultations", data.consultations.length, () => tx.consultation.createMany({ data: data.consultations, ...opts })],
          ["prescriptions", data.prescriptions.length, () => tx.prescription.createMany({ data: data.prescriptions, ...opts })],
          ["prescription_items", data.prescriptionItems.length, () => tx.prescriptionItem.createMany({ data: data.prescriptionItems, ...opts })],
          ["invoices", data.invoices.length, () => tx.invoice.createMany({ data: data.invoices, ...opts })],
          ["invoice_line_items", data.invoiceLineItems.length, () => tx.invoiceLineItem.createMany({ data: data.invoiceLineItems, ...opts })],
          ["payments", data.payments.length, () => tx.payment.createMany({ data: data.payments, ...opts })],
        ];
        const out: { table: string; inserted: number; skipped: number }[] = [];
        for (const [table, total, run] of steps) {
          const { count } = await run();
          out.push({ table, inserted: count, skipped: total - count });
        }
        // Portal links only fill an EMPTY patients.userId — never overwrite an existing link.
        let linked = 0;
        for (const link of data.patientLinks) {
          linked += (await tx.patient.updateMany({ where: { id: link.patientId, userId: null }, data: { userId: link.userId } })).count;
        }
        out.push({ table: "patient_portal_links", inserted: linked, skipped: data.patientLinks.length - linked });
        return out;
      },
      { maxWait: 10_000, timeout: 120_000 }
    );

    console.table(results);
    const inserted = results.reduce((s, r) => s + r.inserted, 0);
    console.log(inserted === 0 ? "Demo data already present — nothing inserted." : `Inserted ${inserted} rows.`);
    console.log("Run `npm run db:status` to see current table counts.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
