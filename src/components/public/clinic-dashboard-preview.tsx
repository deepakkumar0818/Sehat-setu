import { CalendarClockIcon, IndianRupeeIcon, UsersIcon, VideoIcon } from "lucide-react";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatCard } from "@/components/public/stat-card";

const STATS = [
  { icon: CalendarClockIcon, label: "Today's Appointments", value: "24", tone: "primary" as const },
  { icon: UsersIcon, label: "Waiting Patients", value: "6", tone: "warning" as const },
  { icon: VideoIcon, label: "Online Consultations", value: "4", tone: "info" as const },
  { icon: IndianRupeeIcon, label: "Revenue Today", value: "₹48,600", tone: "success" as const },
];

const UPCOMING = [
  { name: "Dr. Anmol Sharma", color: "#2563EB", time: "10:30 AM", note: "Patient consultation" },
  { name: "Dr. Priya Mehta", color: "#0F766E", time: "11:00 AM", note: "Follow-up" },
  { name: "Dr. Rohan Kapoor", color: "#7C3AED", time: "11:30 AM", note: "Online consultation" },
];

export function ClinicDashboardPreview() {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4 shadow-2xl backdrop-blur-sm sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Clinic overview</p>
        <span className="rounded-full bg-success/20 px-2.5 py-1 text-[11px] font-medium text-success">Live demo data</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map((s) => (
          <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} tone={s.tone} className="border-white/10 bg-white/[0.06]" />
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Upcoming appointments</p>
        <div className="mt-3 space-y-2.5">
          {UPCOMING.map((a) => (
            <div key={a.name + a.time} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-2.5">
              <PersonAvatar name={a.name} color={a.color} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{a.name}</p>
                <p className="truncate text-xs text-white/55">{a.note}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-white/70">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
