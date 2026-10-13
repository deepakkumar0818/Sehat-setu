import { can, canAll, canAny } from "@/lib/rbac";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";

/** True if the signed-in user holds the given permission key. */
export function useCan(permissionKey: string): boolean {
  const user = useCurrentUser();
  const db = useDataStore((s) => s.db);
  return can(user, permissionKey, db);
}

/** True if the signed-in user holds every one of the given permission keys. */
export function useCanAll(permissionKeys: string[]): boolean {
  const user = useCurrentUser();
  const db = useDataStore((s) => s.db);
  return canAll(user, permissionKeys, db);
}

/** True if the signed-in user holds at least one of the given permission keys. */
export function useCanAny(permissionKeys: string[]): boolean {
  const user = useCurrentUser();
  const db = useDataStore((s) => s.db);
  return canAny(user, permissionKeys, db);
}
