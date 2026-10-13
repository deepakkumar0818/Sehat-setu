import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/reset-db";
import { createManualInvoice, recordPayment } from "@/services/billing";
import { getDb } from "@/store/data-store";

describe("billing service", () => {
  beforeEach(resetDb);

  it("computes subtotal, tax, and total correctly for a manual invoice", async () => {
    const branch = getDb().branches[0];
    const patient = getDb().patients.find((p) => p.branchId === branch.id)!;

    const invoice = await createManualInvoice({
      patientId: patient.id,
      branchId: branch.id,
      discount: 50,
      taxRate: 10,
      items: [
        { description: "Consultation", category: "consultation", quantity: 1, unitPrice: 500, amount: 500 },
        { description: "Paracetamol", category: "medicine", quantity: 2, unitPrice: 20, amount: 40 },
      ],
    });

    expect(invoice.subtotal).toBe(540);
    expect(invoice.tax).toBe(49); // 10% of the discounted amount (540 − 50), same rule as the clinic database
    expect(invoice.total).toBe(540 - 50 + 49);
    expect(invoice.status).toBe("pending");
    expect(invoice.balance).toBe(invoice.total);
  });

  it("moves an invoice to partial then paid as payments are recorded", async () => {
    const branch = getDb().branches[0];
    const patient = getDb().patients.find((p) => p.branchId === branch.id)!;
    const invoice = await createManualInvoice({
      patientId: patient.id,
      branchId: branch.id,
      items: [{ description: "Consultation", category: "consultation", quantity: 1, unitPrice: 1000, amount: 1000 }],
    });

    const afterFirst = await recordPayment(invoice.id, 400, "cash");
    expect(afterFirst.invoice.status).toBe("partial");
    expect(afterFirst.invoice.balance).toBe(600);

    const afterSecond = await recordPayment(invoice.id, 600, "upi");
    expect(afterSecond.invoice.status).toBe("paid");
    expect(afterSecond.invoice.balance).toBe(0);
  });

  it("never overpays an invoice beyond its total", async () => {
    const branch = getDb().branches[0];
    const patient = getDb().patients.find((p) => p.branchId === branch.id)!;
    const invoice = await createManualInvoice({
      patientId: patient.id,
      branchId: branch.id,
      items: [{ description: "Consultation", category: "consultation", quantity: 1, unitPrice: 300, amount: 300 }],
    });

    const { invoice: paid } = await recordPayment(invoice.id, 1000, "card");
    expect(paid.paid).toBe(300);
    expect(paid.balance).toBe(0);
    expect(paid.status).toBe("paid");
  });
});
