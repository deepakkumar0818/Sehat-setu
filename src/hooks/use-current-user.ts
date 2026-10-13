import { useAuthStore } from "@/store/auth-store";

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}
