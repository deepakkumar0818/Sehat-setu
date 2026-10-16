import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PortalBookingRequest } from "@/lib/live-api";
import type { PortalAppointmentScope } from "@/lib/live-types";
import { liveApi } from "@/lib/live-api";

// Patient portal (P6.3), live mode only. No mock fallback: errors are shown as errors.
// The server decides whose records these are; nothing here sends a patient id.

export function usePortalSummary() {
  return useQuery({ queryKey: ["portal", "summary"], queryFn: () => liveApi.portal.summary() });
}

export function usePortalLabReports(page = 1) {
  return useQuery({ queryKey: ["portal", "lab-reports", page], queryFn: () => liveApi.portal.labReports({ page, pageSize: 20 }), placeholderData: (p) => p });
}

export function usePortalLabReport(id: string | undefined) {
  return useQuery({ queryKey: ["portal", "lab-report", id], queryFn: () => liveApi.portal.labReport(id!), enabled: Boolean(id), retry: false });
}

export function usePortalDocuments(page = 1) {
  return useQuery({ queryKey: ["portal", "documents", page], queryFn: () => liveApi.portal.documents({ page, pageSize: 30 }), placeholderData: (p) => p });
}

export function usePortalDownload() {
  return useMutation({ mutationFn: (id: string) => liveApi.portal.download(id) });
}

// --- Own appointments, booking, invoices and record -------------------------------


const APPTS = ["portal", "appointments"] as const;

/** After any booking change: the lists, the home dashboard and the onboarding appointment picker. */
function useInvalidateBookings() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: APPTS }),
      qc.invalidateQueries({ queryKey: ["portal", "appointment"] }),
      qc.invalidateQueries({ queryKey: ["portal", "dashboard"] }),
      qc.invalidateQueries({ queryKey: ["portal", "slots"] }),
    ]);
}

export function usePortalDashboard() {
  return useQuery({ queryKey: ["portal", "dashboard"], queryFn: () => liveApi.portal.dashboard() });
}

export function usePortalAppointments(scope: PortalAppointmentScope, page = 1) {
  return useQuery({ queryKey: [...APPTS, scope, page], queryFn: () => liveApi.portal.appointments({ scope, page, pageSize: 10 }), placeholderData: (p) => p });
}

export function usePortalAppointment(id: string | undefined) {
  return useQuery({ queryKey: ["portal", "appointment", id], queryFn: () => liveApi.portal.appointment(id!), enabled: Boolean(id), retry: false });
}

export function usePortalBookingOptions() {
  return useQuery({ queryKey: ["portal", "booking-options"], queryFn: () => liveApi.portal.bookingOptions(), staleTime: 5 * 60_000 });
}

export function usePortalSlots(params: { doctorId?: string; branchId?: string; date?: string }) {
  const { doctorId, branchId, date } = params;
  return useQuery({
    queryKey: ["portal", "slots", doctorId, branchId, date],
    queryFn: () => liveApi.portal.slots({ doctorId: doctorId!, branchId: branchId!, date: date! }),
    enabled: Boolean(doctorId && branchId && date),
    staleTime: 15_000,
  });
}

export function usePortalBook() {
  const invalidate = useInvalidateBookings();
  return useMutation({ mutationFn: (input: PortalBookingRequest) => liveApi.portal.book(input), onSuccess: invalidate, meta: { inlineErrors: true } });
}

export function usePortalCancel() {
  const invalidate = useInvalidateBookings();
  return useMutation({ mutationFn: (id: string) => liveApi.portal.cancel(id), onSuccess: invalidate, meta: { inlineErrors: true } });
}

export function usePortalReschedule() {
  const invalidate = useInvalidateBookings();
  return useMutation({
    mutationFn: ({ id, date, time }: { id: string; date: string; time: string }) => liveApi.portal.reschedule(id, { date, time }),
    onSuccess: invalidate,
    meta: { inlineErrors: true },
  });
}

export function usePortalInvoices(page = 1) {
  return useQuery({ queryKey: ["portal", "invoices", page], queryFn: () => liveApi.portal.invoices({ page, pageSize: 20 }), placeholderData: (p) => p });
}

export function usePortalRecord() {
  return useQuery({ queryKey: ["portal", "record"], queryFn: () => liveApi.portal.record() });
}

export function usePortalClinic() {
  return useQuery({ queryKey: ["portal", "clinic"], queryFn: () => liveApi.portal.clinic(), staleTime: 10 * 60_000 });
}

/**
 * Pay a bill or a booking fee online: the server creates the Razorpay order for
 * what's due, Checkout collects the payment, and the server verifies the
 * signature before recording it. Resolves null if the patient closes the window.
 */
export function usePortalPay() {
  const qc = useQueryClient();
  return useMutation({
    meta: { inlineErrors: true },
    mutationFn: async (input: { purpose: "invoice" | "booking_fee"; id: string }) => {
      const { openCheckout } = await import("@/lib/razorpay-checkout");
      const options = await liveApi.portal.startPayment(input);
      const success = await openCheckout(options);
      if (!success) return null;
      return liveApi.portal.verifyPayment(success);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["portal"] }),
  });
}
