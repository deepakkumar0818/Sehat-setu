import { AppointmentsTable } from "@/components/appointments/appointments-table";
import { useAppointments } from "@/hooks/use-appointments";

export function AppointmentsTab({ patientId }: { patientId: string }) {
  const { data, isLoading } = useAppointments({ patientId, pageSize: 50 });
  return <AppointmentsTable rows={data?.items ?? []} isLoading={isLoading} />;
}
