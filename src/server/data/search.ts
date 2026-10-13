import "server-only";
import { hasAnyPermission, appointmentScopeFilter, type TenantContext } from "@/server/auth/authorize";
import { istDayKey } from "@/lib/ist";
import type { TenantTx } from "@/server/db/tenant";
import type { GlobalSearchResults } from "@/services/search";
import { runScoped } from "./scope";

// Command-palette search over the database. Each section is included only if
// the user may see that kind of record; sections for modules that aren't
// connected to the database yet (prescriptions, reports, invoices) stay empty.

export async function globalSearch(ctx: TenantContext, query: string, db?: TenantTx, limit = 5): Promise<GlobalSearchResults> {
  const q = query.trim().slice(0, 100);
  const empty: GlobalSearchResults = { patients: [], doctors: [], appointments: [], prescriptions: [], reports: [], invoices: [] };
  if (q.length < 2) return empty;
  const ci = { contains: q, mode: "insensitive" as const };
  const seePatients = hasAnyPermission(ctx, ["patient.view", "patient.basic_info.view", "assigned_patients.view"]);
  const seeAppointments = ctx.careScope !== "none";

  return runScoped(ctx, db, async (tx) => {
    const [patients, doctors, appointments] = await Promise.all([
      seePatients
        ? tx.patient.findMany({
            where: {
              clinicId: ctx.clinicId,
              OR: [{ name: ci }, { patientNumber: ci }, { phone: { contains: q } }],
              ...(hasAnyPermission(ctx, ["patient.view", "patient.basic_info.view"]) ? {} : { appointments: { some: { doctorId: ctx.doctorId ?? "" } } }),
            },
            take: limit,
            orderBy: { name: "asc" },
            select: { id: true, name: true, patientNumber: true, phone: true },
          })
        : [],
      tx.doctorProfile.findMany({
        where: { clinicId: ctx.clinicId, OR: [{ user: { name: ci } }, { specialty: { name: ci } }] },
        take: limit,
        select: { id: true, user: { select: { name: true } }, specialty: { select: { name: true } } },
      }),
      seeAppointments
        ? tx.appointment.findMany({
            where: {
              clinicId: ctx.clinicId,
              ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
              ...appointmentScopeFilter(ctx),
              OR: [{ reason: ci }, { patient: { name: ci } }],
            },
            take: limit,
            orderBy: { startsAt: "desc" },
            select: { id: true, startsAt: true, reason: true, patientId: true },
          })
        : [],
    ]);
    const apptPatients = appointments.length
      ? new Map((await tx.patient.findMany({ where: { id: { in: appointments.map((a) => a.patientId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]))
      : new Map<string, string>();

    return {
      ...empty,
      patients: patients.map((p) => ({ id: p.id, title: p.name, subtitle: `${p.patientNumber} · ${p.phone}`, href: `/patients/${p.id}` })),
      doctors: doctors.map((d) => ({ id: d.id, title: d.user.name, subtitle: d.specialty.name, href: `/doctor-roster/${d.id}` })),
      appointments: appointments.map((a) => {
        const k = istDayKey(a.startsAt);
        return { id: a.id, title: `${apptPatients.get(a.patientId) ?? "Appointment"} — ${k.date}`, subtitle: `${k.time} · ${a.reason}`, href: "/appointments" };
      }),
    };
  });
}
