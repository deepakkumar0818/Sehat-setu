import { describe, expect, it } from "vitest";
import { readData, renderNotification } from "./notification-templates";

const BRANCH = "8f8f8f8f-1111-4222-8333-444444444444";
const MEDICINE = "9a9a9a9a-1111-4222-8333-444444444444";
const names = (id: string | null) => (id === BRANCH ? "Wakad" : null);
const startsAt = "2026-10-14T05:00:00.000Z"; // 10:30 IST

describe("notification templates", () => {
  it("appointment events: fixed text, IST time, branch name, protected link", () => {
    const r = renderNotification({ type: "APPOINTMENT_CHECKED_IN", refId: MEDICINE, branchId: null, data: { startsAt, branchId: BRANCH } }, names);
    expect(r).toMatchObject({ type: "appointment_checked_in", title: "Patient checked in", link: "/waiting-room" });
    expect(r?.body).toContain("10:30");
    expect(r?.body).toContain("Wakad");
    const re = renderNotification({ type: "APPOINTMENT_RESCHEDULED", refId: null, branchId: null, data: { startsAt, previousStartsAt: "2026-10-13T05:00:00.000Z" } }, names);
    expect(re?.body).toMatch(/moved to/);
    expect(renderNotification({ type: "APPOINTMENT_CANCELLED", refId: null, branchId: null, data: { startsAt, reason: "reassigned" } }, names)?.title).toBe("Appointment reassigned");
  });

  it("stock alerts link to the protected stock page", () => {
    const r = renderNotification({ type: "STOCK_LOW", refId: MEDICINE, branchId: BRANCH, data: { medicineName: "Paracetamol 500 mg", usable: 3, reorderLevel: 10 } }, names);
    expect(r).toMatchObject({ type: "stock_low", link: `/inventory/${BRANCH}/${MEDICINE}` });
    expect(r?.body).toBe("Paracetamol 500 mg is down to 3 usable units at Wakad (reorder level 10).");
    expect(renderNotification({ type: "STOCK_OUT", refId: MEDICINE, branchId: BRANCH, data: { medicineName: "X" } }, names)?.title).toBe("Out of stock");
  });

  it("only allow-listed data is used: unknown keys (e.g. a patient name) never reach the text", () => {
    const data = { startsAt, patientName: "Ravi Kumar", diagnosis: "Hypertension", reason: "chest pain", note: "<script>" };
    for (const type of ["APPOINTMENT_BOOKED", "APPOINTMENT_CANCELLED", "APPOINTMENT_CHECKED_IN", "APPOINTMENT_RESCHEDULED", "STOCK_LOW", "STOCK_OUT", "STAFF_INVITATION_ACCEPTED"]) {
      const r = renderNotification({ type, refId: null, branchId: null, data }, names);
      const text = `${r?.title} ${r?.body} ${r?.link}`;
      expect(text, type).not.toMatch(/Ravi|Kumar|Hypertension|chest pain|<script>/);
    }
    expect(Object.keys(readData(data))).not.toContain("patientName");
  });

  it("malformed values are dropped, not echoed", () => {
    const d = readData({ startsAt: "not a date", branchId: "../etc", usable: -5, role: "ADMINISTRATOR", medicineName: "A\u0000B" });
    expect(d).toMatchObject({ startsAt: null, branchId: null, usable: null, role: null, medicineName: "AB" });
    expect(renderNotification({ type: "STOCK_LOW", refId: "x", branchId: "y", data: {} }, names)?.link).toBe("/inventory");
  });

  it("invitation accepted names the role, never the person", () => {
    const r = renderNotification({ type: "STAFF_INVITATION_ACCEPTED", refId: null, branchId: null, data: { role: "DOCTOR", branchId: BRANCH } }, names);
    expect(r?.body).toBe("A new Doctor joined at Wakad.");
    expect(r?.link).toBe("/staff?tab=invitations");
  });

  it("unknown types render nothing", () => {
    expect(renderNotification({ type: "SOMETHING_ELSE", refId: null, branchId: null, data: {} }, names)).toBeNull();
  });
});
