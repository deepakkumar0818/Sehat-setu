import { createAppointment } from "@/services/appointments";
import { createInvoiceForAppointment, recordPayment } from "@/services/billing";
import type { Appointment, AppointmentType, Invoice, Payment, PaymentMethod } from "@/types";

// Orchestrates a public booking into the SAME records the rest of the app
// uses — the resulting appointment shows up on the doctor's schedule, the
// clinic's dashboard, and the patient's own portal immediately, exactly like
// one booked by a receptionist. This intentionally reuses the existing
// appointment/billing services rather than writing a parallel "public
// booking" data model.

export interface SubmitBookingInput {
  patientId: string;
  doctorId: string;
  branchId: string;
  date: string;
  time: string;
  type: AppointmentType;
  reason: string;
  fee: number;
  paymentMethod: PaymentMethod;
}

export interface BookingConfirmation {
  appointment: Appointment;
  invoice: Invoice;
  payment: Payment;
}

export async function submitBooking(input: SubmitBookingInput): Promise<BookingConfirmation> {
  const appointment = await createAppointment({
    patientId: input.patientId,
    doctorId: input.doctorId,
    branchId: input.branchId,
    date: input.date,
    time: input.time,
    type: input.type,
    reason: input.reason,
    fee: input.fee,
  });

  const invoice = await createInvoiceForAppointment(appointment.id);
  const { invoice: paidInvoice, payment } = await recordPayment(invoice.id, invoice.total, input.paymentMethod);

  return { appointment, invoice: paidInvoice, payment };
}
