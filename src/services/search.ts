import { delay } from "@/lib/async";
import { getDb } from "@/store/data-store";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface GlobalSearchResults {
  patients: SearchResultItem[];
  doctors: SearchResultItem[];
  appointments: SearchResultItem[];
  prescriptions: SearchResultItem[];
  reports: SearchResultItem[];
  invoices: SearchResultItem[];
}

const EMPTY: GlobalSearchResults = {
  patients: [],
  doctors: [],
  appointments: [],
  prescriptions: [],
  reports: [],
  invoices: [],
};

export async function globalSearch(query: string, limit = 5): Promise<GlobalSearchResults> {
  await delay(250);
  const q = query.trim().toLowerCase();
  if (!q) return EMPTY;
  const db = getDb();

  const patients = db.patients
    .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.phone.includes(q))
    .slice(0, limit)
    .map((p) => ({ id: p.id, title: p.name, subtitle: `${p.id} · ${p.phone}`, href: `/patients/${p.id}` }));

  const doctors = db.doctors
    .filter((d) => d.name.toLowerCase().includes(q) || d.specialization.toLowerCase().includes(q))
    .slice(0, limit)
    .map((d) => ({ id: d.id, title: d.name, subtitle: d.specialization, href: `/doctor-roster/${d.id}` }));

  const appointments = db.appointments
    .filter((a) => a.id.toLowerCase().includes(q) || a.reason.toLowerCase().includes(q))
    .slice(0, limit)
    .map((a) => {
      const patient = db.patients.find((p) => p.id === a.patientId);
      return { id: a.id, title: `${patient?.name ?? "Appointment"} — ${a.date}`, subtitle: `${a.time} · ${a.reason}`, href: `/appointments` };
    });

  const prescriptions = db.prescriptions
    .filter((rx) => rx.id.toLowerCase().includes(q) || rx.items.some((i) => i.medicineName.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((rx) => {
      const patient = db.patients.find((p) => p.id === rx.patientId);
      return { id: rx.id, title: `${patient?.name ?? "Prescription"} — ${rx.id}`, subtitle: rx.items.map((i) => i.medicineName).join(", "), href: `/prescriptions/${rx.id}` };
    });

  const reports = db.labReports
    .filter((r) => r.id.toLowerCase().includes(q) || r.type.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
    .slice(0, limit)
    .map((r) => {
      const patient = db.patients.find((p) => p.id === r.patientId);
      return { id: r.id, title: `${patient?.name ?? "Report"} — ${r.title}`, subtitle: r.date, href: `/reports/${r.id}` };
    });

  const invoices = db.invoices
    .filter((inv) => inv.id.toLowerCase().includes(q))
    .slice(0, limit)
    .map((inv) => {
      const patient = db.patients.find((p) => p.id === inv.patientId);
      return { id: inv.id, title: `${inv.id} — ${patient?.name ?? "Patient"}`, subtitle: `₹${inv.total.toLocaleString("en-IN")} · ${inv.status}`, href: `/billing/${inv.id}` };
    });

  return { patients, doctors, appointments, prescriptions, reports, invoices };
}
