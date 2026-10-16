"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDays, addMonths, addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { AppointmentFormDialog } from "@/components/appointments/appointment-form-dialog";
import { MonthGrid } from "@/components/appointments/month-grid";
import { useAppointments } from "@/hooks/use-appointments";
import { useDoctorOptions } from "@/hooks/use-people";
import { useAppNow } from "@/lib/data-source";
import type { AppointmentStatus, AppointmentType } from "@/types";

type ViewMode = "day" | "week" | "month";

export default function AppointmentsPage() {
  const searchParams = useSearchParams();
  const doctors = useDoctorOptions();
  const now = useAppNow(); // real time with live data, the demo clock otherwise

  const [view, setView] = useState<ViewMode>("day");
  const [anchorDate, setAnchorDate] = useState(now);
  const [doctorId, setDoctorId] = useState<string>("all");
  const [status, setStatus] = useState<AppointmentStatus | "all">("all");
  const [type, setType] = useState<AppointmentType | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");

  const dateIso = format(anchorDate, "yyyy-MM-dd");
  const weekStart = startOfWeek(anchorDate);
  const weekEnd = endOfWeek(anchorDate);

  // Only the visible view's range is fetched; the others load when their tab is opened.
  const dayQuery = useAppointments({ date: dateIso, doctorId, status, type, pageSize: 100 }, { enabled: view === "day" });
  const weekQuery = useAppointments(
    {
      dateFrom: format(weekStart, "yyyy-MM-dd"),
      dateTo: format(weekEnd, "yyyy-MM-dd"),
      doctorId,
      status,
      type,
      pageSize: 200,
    },
    { enabled: view === "week" }
  );
  const monthQuery = useAppointments(
    {
      dateFrom: format(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1), "yyyy-MM-dd"),
      dateTo: format(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0), "yyyy-MM-dd"),
      doctorId,
      status,
      type,
      pageSize: 500,
    },
    { enabled: view === "month" }
  );

  const navigate = (dir: 1 | -1) => {
    if (view === "day") setAnchorDate((d) => addDays(d, dir));
    else if (view === "week") setAnchorDate((d) => addWeeks(d, dir));
    else setAnchorDate((d) => addMonths(d, dir));
  };

  const label = useMemo(() => {
    if (view === "day") return format(anchorDate, "EEEE, dd MMMM yyyy");
    if (view === "week") return `${format(weekStart, "dd MMM")} – ${format(weekEnd, "dd MMM yyyy")}`;
    return format(anchorDate, "MMMM yyyy");
  }, [view, anchorDate, weekStart, weekEnd]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Appointments"
        description="Schedule and manage patient appointments across your clinic."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon /> New Appointment
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} aria-label="Previous">
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchorDate(now)}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => navigate(1)} aria-label="Next">
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <p className="ml-2 text-sm font-medium text-foreground">{label}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All doctors" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All doctors</SelectItem>
              {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus | "all")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="in_consultation">In Consultation</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="no_show">No Show</SelectItem>
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setType(v as AppointmentType | "all")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="in_person">In-person</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="follow_up">Follow-up</SelectItem>
              <SelectItem value="walk_in">Walk-in</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {view === "day" && (
        <div className="overflow-hidden rounded-lg border">
          <AppointmentsTable rows={dayQuery.data?.items ?? []} isLoading={dayQuery.isLoading} />
        </div>
      )}
      {view === "week" && (
        <div className="overflow-hidden rounded-lg border">
          <AppointmentsTable rows={weekQuery.data?.items ?? []} isLoading={weekQuery.isLoading} showDateColumn />
        </div>
      )}
      {view === "month" && (
        <MonthGrid
          month={anchorDate}
          appointments={monthQuery.data?.items ?? []}
          onSelectDay={(date) => {
            setAnchorDate(date);
            setView("day");
          }}
        />
      )}

      <AppointmentFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
