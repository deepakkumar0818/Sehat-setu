import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/query-keys";
import { useLiveData } from "@/lib/data-source";
import { liveApi } from "@/lib/live-api";
import {
  createExpense,
  createInvoiceForAppointment,
  createManualInvoice,
  getBillingSummary,
  getInvoice,
  listExpenses,
  listInvoices,
  listPayments,
  recordPayment,
  type CreateManualInvoiceInput,
  type ListExpensesParams,
  type ListInvoicesParams,
  type ListPaymentsParams,
} from "@/services/billing";
import type { Expense, PaymentMethod } from "@/types";

// In the authenticated staff app (live) invoices, payments and the billing
// summary come from the clinic database API; elsewhere from the in-browser mock
// services. Expenses have no database table yet, so they stay mock-only (the
// expenses page carries the demo-data notice). Query keys carry the source.
const src = (live: boolean) => (live ? "live" : "mock");

export function useInvoices(params: ListInvoicesParams) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.billing.invoicesList(params), src(live)],
    queryFn: () => (live ? liveApi.billing.invoices(params) : listInvoices(params)),
    placeholderData: (p) => p,
  });
}

export function useInvoice(id: string | undefined) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.billing.invoiceDetail(id ?? ""), src(live)],
    queryFn: () => (live ? liveApi.billing.invoice(id as string) : getInvoice(id as string)),
    enabled: Boolean(id),
  });
}

function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.billing.invoicesAll });
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.billing.summary });
    queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
  };
}

export function useCreateInvoiceForAppointment() {
  const live = useLiveData();
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (appointmentId: string) => (live ? liveApi.billing.createForAppointment(appointmentId) : createInvoiceForAppointment(appointmentId)),
    onSuccess: invalidate,
  });
}

export function useCreateManualInvoice() {
  const live = useLiveData();
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (input: CreateManualInvoiceInput) => (live ? liveApi.billing.createManual(input) : createManualInvoice(input)),
    onSuccess: invalidate,
  });
}

export function useRecordPayment() {
  const live = useLiveData();
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: async ({ invoiceId, amount, method, reference }: { invoiceId: string; amount: number; method: PaymentMethod; reference?: string }): Promise<void> => {
      if (live) await liveApi.billing.recordPayment(invoiceId, amount, method, reference);
      else await recordPayment(invoiceId, amount, method);
    },
    onSuccess: invalidate,
  });
}

/** Clinic database only (the demo data has no void/refund flow). */
export function useVoidInvoice() {
  const invalidate = useInvalidateBilling();
  return useMutation({ mutationFn: (invoiceId: string) => liveApi.billing.voidInvoice(invoiceId), onSuccess: invalidate });
}

/** Clinic database only: marks a received payment as refunded. */
export function useRefundPayment() {
  const invalidate = useInvalidateBilling();
  return useMutation({ mutationFn: (paymentId: string) => liveApi.billing.refundPayment(paymentId), onSuccess: invalidate });
}

export function usePayments(params: ListPaymentsParams) {
  const live = useLiveData();
  return useQuery({
    queryKey: [...queryKeys.billing.paymentsList(params), src(live)],
    queryFn: () => (live ? liveApi.billing.payments(params) : listPayments(params)),
    placeholderData: (p) => p,
  });
}

export function useExpenses(params: ListExpensesParams) {
  return useQuery({ queryKey: queryKeys.billing.expensesList(params), queryFn: () => listExpenses(params), placeholderData: (p) => p });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Expense, "id">) => createExpense(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useBillingSummary() {
  const live = useLiveData();
  return useQuery({ queryKey: [...queryKeys.billing.summary, src(live)], queryFn: () => (live ? liveApi.billing.summary() : getBillingSummary()) });
}

/** Mock-only summary for the expenses page, which stays on demo data until expenses get a database table. */
export function useDemoBillingSummary() {
  return useQuery({ queryKey: [...queryKeys.billing.summary, "mock"], queryFn: getBillingSummary });
}
