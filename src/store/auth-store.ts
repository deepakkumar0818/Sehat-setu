import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuthUser, UserRole } from "@/types";
import { authenticateUser, resolveDemoUser } from "@/lib/auth";
import { getDb } from "@/store/data-store";

const safeStorage = createJSONStorage<Pick<AuthStoreState, "user">>(() => ({
  getItem: (name) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  setItem: (name, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(name);
  },
}));

interface AuthStoreState {
  user: AuthUser | null;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  login: (email: string, password: string) => boolean;
  loginAsRole: (role: UserRole) => void;
  logout: () => void;
}

/** Non-hook accessor for service-layer code (mirrors store/data-store.ts's getDb()) — used for tenant-access checks. */
export function getCurrentUser(): AuthUser | null {
  return useAuthStore.getState().user;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set) => ({
      user: null,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      login: (email, password) => {
        const user = authenticateUser(email, password, getDb());
        if (!user) return false;
        set({ user });
        return true;
      },
      loginAsRole: (role) => set({ user: resolveDemoUser(role, getDb()) }),
      logout: () => set({ user: null }),
    }),
    {
      name: "sehat-setu-auth",
      storage: safeStorage,
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
