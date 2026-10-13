import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { CURRENT_SEED_VERSION, generateDatabase } from "@/data/seed";
import type { SehatSetuDatabase } from "@/types";

// SSR-safe storage: Next.js pre-renders client components on the server,
// where `localStorage` does not exist.
const safeStorage = createJSONStorage<Pick<DataStoreState, "db">>(() => ({
  getItem: (name) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  setItem: (name, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(name);
  },
}));

interface DataStoreState {
  db: SehatSetuDatabase;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setDb: (updater: (db: SehatSetuDatabase) => SehatSetuDatabase) => void;
  resetDemoData: () => void;
}

export const useDataStore = create<DataStoreState>()(
  persist(
    (set) => ({
      db: generateDatabase(),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setDb: (updater) => set((state) => ({ db: updater(state.db) })),
      resetDemoData: () => set({ db: generateDatabase(Date.now()) }),
    }),
    {
      name: "sehat-setu-db",
      storage: safeStorage,
      version: CURRENT_SEED_VERSION,
      migrate: () => ({ db: generateDatabase() }) as Pick<DataStoreState, "db">,
      // Belt-and-braces: a bumped seed version should always trigger `migrate`
      // above, but a stale localStorage blob from mid-development (saved
      // between two edits that together changed the shape) can otherwise
      // slip through with a matching version number and a genuinely
      // incompatible `db` shape. Regenerate whenever the persisted `db` is
      // missing a top-level key the current SehatSetuDatabase requires,
      // rather than trusting the version number alone.
      merge: (persisted, current) => {
        const persistedDb = (persisted as Partial<DataStoreState> | undefined)?.db;
        const hasCurrentShape = persistedDb && Object.keys(current.db).every((key) => key in persistedDb);
        return hasCurrentShape ? { ...current, ...(persisted as object) } : current;
      },
      partialize: (state) => ({ db: state.db }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

/** Convenience accessor for services (non-hook context). */
export function getDb(): SehatSetuDatabase {
  return useDataStore.getState().db;
}

export function mutateDb(updater: (db: SehatSetuDatabase) => SehatSetuDatabase): void {
  useDataStore.getState().setDb(updater);
}
