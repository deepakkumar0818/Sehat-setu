import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { listAuditLog, type ListAuditLogParams } from "@/services/audit";

export function useAuditLog(params: ListAuditLogParams) {
  return useQuery({ queryKey: queryKeys.auditLog.list(params), queryFn: () => listAuditLog(params), placeholderData: (p) => p });
}
