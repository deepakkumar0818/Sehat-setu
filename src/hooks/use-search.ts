import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { globalSearch } from "@/services/search";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";

export function useGlobalSearch(query: string) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.search.global(query), live ? "live" : "mock"],
    queryFn: () => (live ? liveApi.search(query) : globalSearch(query)),
    enabled: query.trim().length > 1,
  });
}
