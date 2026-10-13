import { useQuery } from "@tanstack/react-query";
import { listClinicUsers, type ListClinicUsersParams } from "@/services/clinic-users";

export function useClinicUsers(params: ListClinicUsersParams) {
  return useQuery({
    queryKey: ["clinic-users", params],
    queryFn: () => listClinicUsers(params),
    enabled: Boolean(params.clinicId),
    placeholderData: (prev) => prev,
  });
}
