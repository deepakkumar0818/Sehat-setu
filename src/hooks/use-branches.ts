import { useQuery } from "@tanstack/react-query";
import { useDataStore } from "@/store/data-store";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import type { Branch } from "@/types";

const NONE: Branch[] = [];

/** Branch list for selectors: the clinic database in the live staff app, the mock store otherwise. */
export function useBranches(): Branch[] {
  const live = useLiveData();
  const mockBranches = useDataStore((s) => s.db.branches);
  const { data } = useQuery({ queryKey: ["branches", "live"], queryFn: liveApi.branches.list, enabled: live, staleTime: 5 * 60_000 });
  return live ? (data ?? NONE) : mockBranches;
}
