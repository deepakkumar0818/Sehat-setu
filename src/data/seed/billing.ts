import type { Rng } from "@/lib/rng";
import { padId } from "@/lib/rng";
import type {
  Appointment,
  Consultation,
  Expense,
  ExpenseCategory,
  Invoice,
  InvoiceLineItem,
  Patient,
  Payment,
  PaymentMethod,
  Prescription,
} from "@/types";
import { EXPENSE_DESCRIPTIONS, SUPPLIERS } from "@/data/pools";

interface BillingResult {
  invoices: Invoice[];
  payments: Payment[];
}

function paymentMethodFor(rng: Rng, isOnline: boolean): PaymentMethod {
  if (isOnline) return "online";
  return rng.weighted([
    ["cash", 35],
    ["upi", 35],
    ["card", 20],
    ["bank_transfer", 10],
  ]);
}

export function generateBilling(
  rng: Rng,
  appointments: Appointment[],
  consultations: Consultation[],
  prescriptions: Prescription[],
  now: Date
): BillingResult {
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  let invoiceCounter = 1;
  let paymentCounter = 1;
  const year = now.getFullYear();

  const consultationByAppointment = new Map(consultations.map((c) => [c.appointmentId, c]));
  const prescriptionByConsultation = new Map(prescriptions.filter((p) => p.consultationId).map((p) => [p.consultationId as string, p]));

  const billable = appointments.filter(
    (a) =>
      a.status === "completed" ||
      a.status === "waiting" ||
      a.status === "in_consultation" ||
      (a.status === "upcoming" && a.type === "online" && a.paymentStatus === "paid") ||
      (a.status === "no_show" && rng.bool(0.2))
  );

  for (const appt of billable) {
    const items: InvoiceLineItem[] = [];
    const isNoShowFee = appt.status === "no_show";

    items.push({
      description: isNoShowFee ? "No-show fee" : `Consultation — ${appt.type.replace("_", " ")}`,
      category: "consultation",
      quantity: 1,
      unitPrice: isNoShowFee ? Math.round(appt.fee * 0.3) : appt.fee,
      amount: isNoShowFee ? Math.round(appt.fee * 0.3) : appt.fee,
    });

    const consultation = consultationByAppointment.get(appt.id);
    if (consultation && !isNoShowFee) {
      const prescription = prescriptionByConsultation.get(consultation.id);
      if (prescription) {
        const amount = prescription.items.length * rng.int(60, 260);
        items.push({
          description: "Pharmacy — prescribed medicines",
          category: "medicine",
          quantity: prescription.items.length,
          unitPrice: Math.round(amount / prescription.items.length),
          amount,
        });
      }
      for (const test of consultation.labTestsOrdered) {
        const amount = rng.int(300, 1500);
        items.push({ description: `Lab test — ${test}`, category: "lab_test", quantity: 1, unitPrice: amount, amount });
      }
    }

    const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
    const discount = rng.bool(0.15) ? Math.round(subtotal * 0.05) : 0;
    const taxableAmount = items.filter((i) => i.category !== "consultation").reduce((sum, i) => sum + i.amount, 0);
    const tax = Math.round(taxableAmount * 0.05);
    const total = subtotal - discount + tax;

    let paid = 0;
    let status: Invoice["status"];
    if (appt.paymentStatus === "paid") {
      paid = total;
      status = "paid";
    } else if (appt.paymentStatus === "partial") {
      paid = Math.round(total * rng.float(0.3, 0.7, 2));
      status = "partial";
    } else {
      paid = 0;
      status = "pending";
    }

    const invoice: Invoice = {
      id: `INV-${year}-${String(invoiceCounter++).padStart(5, "0")}`,
      patientId: appt.patientId,
      branchId: appt.branchId,
      appointmentId: appt.id,
      date: appt.date,
      items,
      subtotal,
      discount,
      tax,
      total,
      paid,
      balance: total - paid,
      status,
      paymentMethod: paid > 0 ? paymentMethodFor(rng, appt.type === "online") : undefined,
    };
    invoices.push(invoice);
    appt.invoiceId = invoice.id;

    if (paid > 0) {
      const splitPayment = status === "partial" && rng.bool(0.35);
      if (splitPayment) {
        const first = Math.round(paid * 0.5);
        payments.push({
          id: padId("PY", 100000 + paymentCounter++, 6),
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          date: invoice.date,
          amount: first,
          method: invoice.paymentMethod!,
          status: "success",
        });
        payments.push({
          id: padId("PY", 100000 + paymentCounter++, 6),
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          date: rng.dateOffset(new Date(invoice.date), 1, 5).toISOString().slice(0, 10),
          amount: paid - first,
          method: invoice.paymentMethod!,
          status: "success",
        });
      } else {
        payments.push({
          id: padId("PY", 100000 + paymentCounter++, 6),
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          date: invoice.date,
          amount: paid,
          method: invoice.paymentMethod!,
          status: "success",
        });
      }
    }
  }

  return { invoices, payments };
}

const EXPENSE_RANGES: Record<ExpenseCategory, [number, number]> = {
  rent: [30000, 80000],
  salary: [15000, 60000],
  utilities: [2000, 15000],
  equipment: [5000, 100000],
  medicine_purchase: [10000, 150000],
  lab_expense: [5000, 40000],
  marketing: [2000, 30000],
  maintenance: [1000, 20000],
  other: [500, 10000],
};

export function generateExpenses(rng: Rng, branchIds: string[], now: Date, count = 110): Expense[] {
  const categories = Object.keys(EXPENSE_RANGES) as ExpenseCategory[];
  const expenses: Expense[] = [];
  for (let i = 0; i < count; i++) {
    const category = rng.pick(categories);
    const [min, max] = EXPENSE_RANGES[category];
    const date = rng.dateOffset(now, -180, -1).toISOString().slice(0, 10);
    expenses.push({
      id: padId("EX", 1000 + i + 1, 4),
      branchId: rng.pick(branchIds),
      category,
      description: rng.pick(EXPENSE_DESCRIPTIONS[category]),
      amount: rng.int(min, max),
      date,
      paidTo: category === "salary" ? undefined : rng.pick(SUPPLIERS),
    });
  }
  return expenses;
}
