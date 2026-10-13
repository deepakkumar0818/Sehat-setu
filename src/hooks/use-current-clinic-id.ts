import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";

/**
 * The clinic tenant the current session is scoped to. Falls back to the
 * first seeded clinic for super_admin (a platform-level role with no
 * clinicId of its own) so platform staff can still open clinic-management
 * screens in this prototype's single-clinic-by-default demo data.
 */
export function useCurrentClinicId(): string | undefined {
  const user = useCurrentUser();
  const firstClinicId = useDataStore((s) => s.db.clinics?.[0]?.id);
  return user?.clinicId ?? firstClinicId;
}
