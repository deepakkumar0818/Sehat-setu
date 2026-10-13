import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import type { CreateInvitationInput } from "@/lib/live-types";

// Staff invitations exist only in the clinic database (live mode). There is no
// demo/mock version: in demo mode these queries are disabled and the UI hides them.

export function useInvitations(params: { status?: string; page?: number; pageSize?: number }, enabled = true) {
  const live = useLiveData();
  return useQuery({
    queryKey: ["invitations", "live", "list", params],
    queryFn: () => liveApi.invitations.list(params),
    enabled: live && enabled,
    placeholderData: (p) => p,
  });
}

function useInvalidateInvitations() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: ["invitations"] }), queryClient.invalidateQueries({ queryKey: ["staff"] })]);
}

export function useCreateInvitation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) => liveApi.invitations.create(input),
    onSuccess: invalidate,
    // The dialog shows validation/conflict errors next to the form.
    meta: { inlineErrors: true },
  });
}

export function useResendInvitation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({ mutationFn: (id: string) => liveApi.invitations.resend(id), onSuccess: invalidate, onError: invalidate });
}

export function useRevokeInvitation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({ mutationFn: (id: string) => liveApi.invitations.revoke(id), onSuccess: invalidate });
}

/** The signed-in user's own pending invitations (works before they belong to any clinic). */
export function useMyInvitations(enabled = true) {
  return useQuery({ queryKey: ["invitations", "mine"], queryFn: liveApi.me.invitations, enabled, staleTime: 30_000 });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => liveApi.me.acceptInvitation(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["invitations", "mine"] }),
    meta: { inlineErrors: true },
  });
}
