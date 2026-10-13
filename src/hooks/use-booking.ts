import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitBooking, type SubmitBookingInput } from "@/services/booking";
import { confirmPayment, createPaymentIntent } from "@/services/payments";
import type { PaymentMethod } from "@/types";
import { queryKeys } from "@/hooks/query-keys";

export function useCreatePaymentIntent() {
  return useMutation({ mutationFn: (amount: number) => createPaymentIntent(amount) });
}

export function useConfirmPayment() {
  return useMutation({
    mutationFn: ({ intentId, method }: { intentId: string; method: PaymentMethod }) => confirmPayment(intentId, method),
  });
}

export function useSubmitBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitBookingInput) => submitBooking(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.invoicesAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.kpis });
    },
  });
}
