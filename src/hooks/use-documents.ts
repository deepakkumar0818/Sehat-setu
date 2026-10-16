import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveApi, type CreateLabReportInput, type ListDocumentsParams, type ListLabReportsParams, type SetLabValuesInput, type UploadDocumentInput } from "@/lib/live-api";
import type { ArchiveReason } from "@/lib/documents";

// Patient documents and lab reports (P6.2) — live staff app only. There is no
// mock fallback: errors (including 403s) are shown as errors by the screens.

const DOCS = ["documents"] as const;
const LABS = ["lab-reports"] as const;

export function useDocumentList(params: ListDocumentsParams, enabled = true) {
  return useQuery({ queryKey: [...DOCS, "list", params], queryFn: () => liveApi.documents.list(params), enabled, placeholderData: (p) => p });
}

export function usePatientDocuments(patientId: string | undefined, params: ListDocumentsParams = {}) {
  return useQuery({
    queryKey: [...DOCS, "patient", patientId, params],
    queryFn: () => liveApi.documents.listForPatient(patientId!, params),
    enabled: Boolean(patientId),
    placeholderData: (p) => p,
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: DOCS }), qc.invalidateQueries({ queryKey: LABS })]);
}

export function useUploadDocument() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ input, onProgress }: { input: UploadDocumentInput; onProgress?: (f: number) => void }) => liveApi.documents.upload(input, onProgress),
    onSuccess: invalidate,
  });
}

export function useArchiveDocument() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: ({ id, reason, note }: { id: string; reason: ArchiveReason; note?: string }) => liveApi.documents.archive(id, { reason, note }), onSuccess: invalidate });
}

export function useDownloadDocument() {
  return useMutation({ mutationFn: (id: string) => liveApi.documents.download(id) });
}

export function useLabReports(params: ListLabReportsParams, enabled = true) {
  return useQuery({ queryKey: [...LABS, "list", params], queryFn: () => liveApi.labReports.list(params), enabled, placeholderData: (p) => p });
}

export function useLabReport(id: string | undefined) {
  return useQuery({ queryKey: [...LABS, "detail", id], queryFn: () => liveApi.labReports.get(id!), enabled: Boolean(id) });
}

export function useCreateLabReport() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: CreateLabReportInput) => liveApi.labReports.create(input), onSuccess: invalidate });
}

function useReportMutation<V>(fn: (v: V) => ReturnType<typeof liveApi.labReports.get>) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData([...LABS, "detail", detail.id], detail);
      return invalidate();
    },
  });
}

export function useSetLabValues() {
  return useReportMutation(({ id, input }: { id: string; input: SetLabValuesInput }) => liveApi.labReports.setValues(id, input));
}

export function useReviewLabReport() {
  return useReportMutation((id: string) => liveApi.labReports.review(id));
}

export function useShareLabReport() {
  return useReportMutation(({ id, shared }: { id: string; shared: boolean }) => (shared ? liveApi.labReports.share(id) : liveApi.labReports.unshare(id)));
}
