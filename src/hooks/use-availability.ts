import { useQuery } from "@tanstack/react-query";
import { getAvailableSlotsForDoctor, getNextAvailableSlot, getNextAvailableSlots } from "@/services/availability";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";

export function useAvailableSlots(doctorId: string | undefined, dateIso: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: ["availability", "slots", doctorId, dateIso, live ? "live" : "mock"],
    queryFn: () => (live ? liveApi.doctors.slots(doctorId as string, dateIso as string) : getAvailableSlotsForDoctor(doctorId as string, dateIso as string)),
    enabled: Boolean(doctorId && dateIso),
  });
}

export function useNextAvailableSlot(doctorId: string | undefined) {
  return useQuery({
    queryKey: ["availability", "next", doctorId],
    queryFn: () => getNextAvailableSlot(doctorId as string),
    enabled: Boolean(doctorId),
  });
}

export function useNextAvailableSlots(doctorIds: string[]) {
  return useQuery({
    queryKey: ["availability", "next-bulk", doctorIds],
    queryFn: () => getNextAvailableSlots(doctorIds),
    enabled: doctorIds.length > 0,
  });
}
