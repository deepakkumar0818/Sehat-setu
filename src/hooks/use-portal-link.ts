import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveApi } from "@/lib/live-api";

// P6.4 patient portal linking codes — live staff app only (patient.portal_link).

const KEY = ["portal-link"] as const;

export function usePortalLinkStatus(patientId: string) {
  return useQuery({ queryKey: [...KEY, patientId], queryFn: () => liveApi.patients.portalLink(patientId), retry: false });
}

export function useIssuePortalLinkCode(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => liveApi.patients.issuePortalLinkCode(patientId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, patientId] }),
  });
}

export function useRevokePortalLinkCode(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => liveApi.patients.revokePortalLinkCode(patientId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, patientId] }),
  });
}
