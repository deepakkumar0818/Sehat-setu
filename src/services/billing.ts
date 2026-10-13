import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { padId } from "@/lib/rng";
import { todayDateStr } from "@/lib/demo-clock";
import { getDb, mutateDb } from "@/store/data-store";
import type { Expense, ExpenseCategory, Invoice, InvoiceLineItem, InvoiceStatus, Payment, PaymentMethod } from "@/types";

export interface InvoiceWithNames extends Invoice {
  patientName: string;
  // Clinic-database detail fields (the demo pages look these up in the mock store instead).
  patientNumber?: string;
  patientPhone?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
  payments?: Payment[];
  /** What the signed-in user may do — UI hints only; the server re-checks every action. */
  capabilities?: { recordPayment: boolean; void: boolean; refund: boolean };
}

function enrichInvoice(inv: Invoice): InvoiceWithNames {
  const db = getDb();
  return { ...inv, patientName: db.patients.find((p) => p.id === inv.patientId)?.name ?? "Unknown patient" };
}

export interface ListInvoicesParams {
  search?: string;
  status?: InvoiceStatus | "all";
  patientId?: string;
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listInvoices(params: ListInvoicesParams = {}): Promise<PagedResult<InvoiceWithNames>> {
  await delay();
  const { search = "", status = "all", patientId, branchId = "all", page = 1, pageSize = 10 } = params;
  const items = getDb()
    .invoices.filter((inv) => {
      if (status !== "all" && inv.status !== status) return false;
      if (patientId && inv.patientId !== patientId) return false;
      if (branchId !== "all" && inv.branchId !== branchId) return false;
      return true;
    })
    .map(enrichInvoice)
    .filter((inv) => matchesSearch([inv.patientName, inv.id], search))
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function getInvoice(id: string): Promise<InvoiceWithNames | undefined> {
  await delay(250);
  const found = getDb().invoices.find((inv) => inv.id === id);
  return found ? enrichInvoice(found) : undefined;
}

export async function createInvoiceForAppointment(appointmentId: string): Promise<Invoice> {
  await delay(450);
  const db = getDb();
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new Error("Appointment not found");
  if (appt.invoiceId) {
    const existing = db.invoices.find((i) => i.id === appt.invoiceId);
    if (existing) return existing;
  }

  const year = new Date().getFullYear();
  const invoice: Invoice = {
    id: `INV-${year}-${String(db.invoices.length + 1).padStart(5, "0")}`,
    patientId: appt.patientId,
    branchId: appt.branchId,
    appointmentId: appt.id,
    date: appt.date,
    items: [
      {
        description: `Consultation — ${appt.type.replace("_", " ")}`,
        category: "consultation",
        quantity: 1,
        unitPrice: appt.fee,
        amount: appt.fee,
      },
    ],
    subtotal: appt.fee,
    discount: 0,
    tax: 0,
    total: appt.fee,
    paid: 0,
    balance: appt.fee,
    status: "pending",
  };

  mutateDb((d) => ({
    ...d,
    invoices: [invoice, ...d.invoices],
    appointments: d.appointments.map((a) => (a.id === appointmentId ? { ...a, invoiceId: invoice.id } : a)),
  }));
  return invoice;
}

export interface CreateManualInvoiceInput {
  patientId: string;
  branchId: string;
  items: InvoiceLineItem[];
  discount?: number;
  taxRate?: number;
}

export async function createManualInvoice(input: CreateManualInvoiceInput): Promise<Invoice> {
  await delay(450);
  const db = getDb();
  const year = new Date().getFullYear();
  const subtotal = input.items.reduce((s, i) => s + i.amount, 0);
  const discount = input.discount ?? 0;
  // Same rule as the clinic database (src/server/data/billing-math.ts): tax on the discounted amount.
  const tax = Math.round(Math.max(0, subtotal - discount) * ((input.taxRate ?? 0) / 100));
  const total = Math.max(0, subtotal - discount + tax);

  const invoice: Invoice = {
    id: `INV-${year}-${String(db.invoices.length + 1).padStart(5, "0")}`,
    patientId: input.patientId,
    branchId: input.branchId,
    date: new Date().toISOString().slice(0, 10),
    items: input.items,
    subtotal,
    discount,
    tax,
    total,
    paid: 0,
    balance: total,
    status: "pending",
  };

  mutateDb((d) => ({ ...d, invoices: [invoice, ...d.invoices] }));
  return invoice;
}

export async function recordPayment(invoiceId: string, amount: number, method: PaymentMethod): Promise<{ invoice: Invoice; payment: Payment }> {
  await delay(500);
  const db = getDb();
  const invoice = db.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  const paid = Math.min(invoice.total, invoice.paid + amount);
  const balance = invoice.total - paid;
  const status: InvoiceStatus = balance <= 0 ? "paid" : "partial";

  const payment: Payment = {
    id: padId("PY", 100000 + db.payments.length + 1, 6),
    invoiceId,
    patientId: invoice.patientId,
    date: new Date().toISOString().slice(0, 10),
    amount,
    method,
    status: "success",
  };

  let updatedInvoice: Invoice = invoice;
  mutateDb((d) => ({
    ...d,
    invoices: d.invoices.map((i) => {
      if (i.id !== invoiceId) return i;
      updatedInvoice = { ...i, paid, balance, status, paymentMethod: method };
      return updatedInvoice;
    }),
    payments: [payment, ...d.payments],
    appointments: d.appointments.map((a) =>
      a.invoiceId === invoiceId ? { ...a, paymentStatus: status === "paid" ? ("paid" as const) : ("partial" as const) } : a
    ),
  }));

  return { invoice: updatedInvoice, payment };
}

export interface ListPaymentsParams {
  search?: string;
  method?: PaymentMethod | "all";
  page?: number;
  pageSize?: number;
}

export async function listPayments(params: ListPaymentsParams = {}): Promise<PagedResult<Payment & { patientName: string }>> {
  await delay();
  const db = getDb();
  const { search = "", method = "all", page = 1, pageSize = 10 } = params;
  const items = db.payments
    .filter((p) => method === "all" || p.method === method)
    .map((p) => ({ ...p, patientName: db.patients.find((pt) => pt.id === p.patientId)?.name ?? "Unknown patient" }))
    .filter((p) => matchesSearch([p.patientName, p.id, p.invoiceId], search))
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export interface ListExpensesParams {
  search?: string;
  category?: ExpenseCategory | "all";
  branchId?: string | "all";
  page?: number;
  pageSize?: number;
}

export async function listExpenses(params: ListExpensesParams = {}): Promise<PagedResult<Expense>> {
  await delay();
  const { search = "", category = "all", branchId = "all", page = 1, pageSize = 10 } = params;
  const items = getDb()
    .expenses.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (branchId !== "all" && e.branchId !== branchId) return false;
      return matchesSearch([e.description, e.paidTo, e.id], search);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return paginate(items, page, pageSize);
}

export async function createExpense(input: Omit<Expense, "id">): Promise<Expense> {
  await delay(400);
  const db = getDb();
  const expense: Expense = { id: padId("EX", 1000 + db.expenses.length + 1, 4), ...input };
  mutateDb((d) => ({ ...d, expenses: [expense, ...d.expenses] }));
  return expense;
}

export interface BillingSummary {
  todaysRevenue: number;
  outstandingBalance: number;
  totalRevenueThisMonth: number;
  /** null when expenses aren't tracked (the clinic database has no expenses table yet). */
  totalExpensesThisMonth: number | null;
  /** Clinic database only: may the signed-in user create invoices (UI hint). */
  canCreateInvoice?: boolean;
}

export async function getBillingSummary(): Promise<BillingSummary> {
  await delay(300);
  const db = getDb();
  const today = todayDateStr();
  const monthPrefix = today.slice(0, 7);

  const todaysRevenue = db.payments.filter((p) => p.date === today).reduce((s, p) => s + p.amount, 0);
  const outstandingBalance = db.invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.balance, 0);
  const totalRevenueThisMonth = db.payments.filter((p) => p.date.startsWith(monthPrefix)).reduce((s, p) => s + p.amount, 0);
  const totalExpensesThisMonth = db.expenses.filter((e) => e.date.startsWith(monthPrefix)).reduce((s, e) => s + e.amount, 0);

  return { todaysRevenue, outstandingBalance, totalRevenueThisMonth, totalExpensesThisMonth };
}
