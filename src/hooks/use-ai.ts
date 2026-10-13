import { useMutation } from "@tanstack/react-query";
import {
  analyzePrescriptionSafety,
  answerClinicQuestion,
  answerPatientQuestion,
  answerPublicQuestion,
  extractMedicalDocument,
  generateConsultationNotes,
  generatePatientSummary,
  summarizeReport,
} from "@/services/ai";
import type { LabReport, PrescriptionItem } from "@/types";

export function useGeneratePatientSummary() {
  return useMutation({ mutationFn: (patientId: string) => generatePatientSummary(patientId) });
}

export function useGenerateConsultationNotes() {
  return useMutation({ mutationFn: (transcript?: string) => generateConsultationNotes(transcript) });
}

export function useSummarizeReport() {
  return useMutation({ mutationFn: (report: LabReport) => summarizeReport(report) });
}

export function useExtractDocument() {
  return useMutation({ mutationFn: (fileName: string) => extractMedicalDocument(fileName) });
}

export function useAnalyzePrescriptionSafety() {
  return useMutation({
    mutationFn: ({ patientId, items }: { patientId: string; items: PrescriptionItem[] }) => analyzePrescriptionSafety(patientId, items),
  });
}

export function useAnswerPatientQuestion() {
  return useMutation({ mutationFn: ({ patientId, question }: { patientId: string; question: string }) => answerPatientQuestion(patientId, question) });
}

export function useAnswerClinicQuestion() {
  return useMutation({ mutationFn: (question: string) => answerClinicQuestion(question) });
}

export function useAnswerPublicQuestion() {
  return useMutation({ mutationFn: (question: string) => answerPublicQuestion(question) });
}
