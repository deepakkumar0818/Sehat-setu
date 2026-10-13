import { generateDatabase } from "@/data/seed";
import { useDataStore } from "@/store/data-store";

/** Resets the shared mock database to a fresh, deterministic snapshot before each test. */
export function resetDb() {
  useDataStore.setState({ db: generateDatabase() });
}
