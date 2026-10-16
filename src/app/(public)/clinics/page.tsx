import { connection } from "next/server";
import { MapPinIcon, PhoneIcon } from "lucide-react";
import { DemoClinicsPage } from "@/components/public/demo-clinics-page";
import { EmptyState } from "@/components/shared/empty-state";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { tryPublicDirectory } from "@/server/data/public-directory";

/** Live site: the clinic's real branches with their public contact details. */
async function LiveClinicsPage() {
  await connection();
  const directory = await tryPublicDirectory();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Our clinics</h1>
      <p className="mt-2 text-muted-foreground">Visit us in person, or sign in to request an appointment online.</p>
      {!directory || directory.branches.length === 0 ? (
        <EmptyState className="mt-8" title="Clinic details are unavailable right now" description="Please try again in a few minutes." />
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {directory.branches.map((b) => {
            const clinic = directory.clinics.find((c) => c.id === b.clinicId);
            const doctors = directory.doctors.filter((d) => d.branchIds.includes(b.id)).length;
            return (
              <div key={b.id} className="rounded-2xl border bg-card p-5">
                <p className="font-semibold text-foreground">{clinic ? `${clinic.name} — ${b.name}` : b.name}</p>
                <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.address}, {b.city}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><PhoneIcon className="h-4 w-4 shrink-0" aria-hidden /> {b.phone}</p>
                <p className="mt-3 text-xs text-muted-foreground">{doctors} doctor{doctors === 1 ? "" : "s"} · Mon–Sat, 9:00 AM – 5:00 PM</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ClinicsPage() {
  return isSupabaseAuthEnabled() ? <LiveClinicsPage /> : <DemoClinicsPage />;
}
