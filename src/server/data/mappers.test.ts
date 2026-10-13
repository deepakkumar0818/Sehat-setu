import { describe, expect, it } from "vitest";
import {
  ageFrom,
  appointmentStatusFromUi,
  appointmentStatusToUi,
  avatarColorFor,
  defaultSlotsFor,
  invoiceStatusToPayment,
  istToInstant,
  toUiDoctor,
  toUiPatient,
} from "./mappers";

describe("IST conversions", () => {
  it("maps an IST wall-clock time to the right UTC instant", () => {
    expect(istToInstant("2026-10-12", "10:30").toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(istToInstant("2026-10-12", "00:00").toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });

  it("rejects malformed or impossible dates instead of rolling them over", () => {
    for (const [d, t] of [["2026-02-31", "10:00"], ["2026-13-01", "10:00"], ["12-10-2026", "10:00"], ["2026-10-12", "24:00"], ["2026-10-12", "9:00"]]) {
      expect(() => istToInstant(d, t)).toThrow();
    }
  });

  it("computes age from date of birth", () => {
    expect(ageFrom(new Date("1990-10-13T00:00:00Z"), new Date("2026-10-12T12:00:00Z"))).toBe(35);
    expect(ageFrom(new Date("1990-10-12T00:00:00Z"), new Date("2026-10-12T12:00:00Z"))).toBe(36);
  });
});

describe("status mapping", () => {
  it("shows scheduled and confirmed as upcoming, and filters 'upcoming' back to both", () => {
    expect(appointmentStatusToUi("SCHEDULED")).toBe("upcoming");
    expect(appointmentStatusToUi("CONFIRMED")).toBe("upcoming");
    expect(appointmentStatusToUi("CHECKED_IN")).toBe("waiting");
    expect(appointmentStatusFromUi("upcoming").sort()).toEqual(["CONFIRMED", "SCHEDULED"]);
    expect(appointmentStatusFromUi("waiting")).toEqual(["CHECKED_IN"]);
  });

  it("derives payment status from the invoice, defaulting to pending", () => {
    expect(invoiceStatusToPayment("PAID")).toBe("paid");
    expect(invoiceStatusToPayment("PARTIALLY_PAID")).toBe("partial");
    expect(invoiceStatusToPayment(undefined)).toBe("pending");
  });
});

describe("default clinic hours", () => {
  it("offers Mon–Sat 09:00–17:00 slots with a lunch break, none on Sunday", () => {
    const monday = defaultSlotsFor("2026-10-12");
    expect(monday[0]).toBe("09:00");
    expect(monday.at(-1)).toBe("16:30");
    expect(monday).not.toContain("13:00");
    expect(monday).not.toContain("13:30");
    expect(defaultSlotsFor("2026-10-18")).toEqual([]); // Sunday
  });
});

describe("record mapping", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    clinicId: "c",
    branchId: "b",
    patientNumber: "AAR-P-0001",
    name: "Test",
    dateOfBirth: new Date("2000-01-01T00:00:00Z"),
    gender: "FEMALE" as const,
    phone: "+91 00000 00001",
    email: null,
    bloodGroup: null,
    addressLine: null,
    city: null,
    allergies: [],
    chronicConditions: [],
    emergencyContactName: null,
    emergencyContactPhone: null,
    status: "ACTIVE" as const,
    createdAt: new Date("2026-10-12T05:00:00Z"),
  };

  it("maps patients without inventing values", () => {
    const p = toUiPatient(base, {}, new Date("2026-10-12T12:00:00Z"));
    expect(p).toMatchObject({ patientNumber: "AAR-P-0001", gender: "female", email: "", bloodGroup: "Unknown", status: "active", registeredDate: "2026-10-12", age: 26 });
    expect(p.lastVisit).toBeUndefined();
    expect(p.emergencyContact).toEqual({ name: "", phone: "", relation: "" });
  });

  it("maps doctors with fees in rupees, no rating, and the primary branch", () => {
    const d = toUiDoctor({
      id: "d1", clinicId: "c", specialtyId: "s", departmentId: null, qualifications: "MBBS", registrationNumber: "R1", experienceYears: 5,
      consultationFeePaise: 65000, bio: null, onlineConsultation: true, status: "ACTIVE", createdAt: new Date("2026-01-01T00:00:00Z"),
      user: { name: "Dr. A", email: "a@example.com", phone: null }, specialty: { name: "Pediatrics" },
      branches: [{ branchId: "b2", isPrimary: false }, { branchId: "b1", isPrimary: true }],
    });
    expect(d).toMatchObject({ consultationFee: 650, rating: null, branchId: "b1", specialization: "Pediatrics", status: "active", phone: "" });
    expect(d.gender).toBeUndefined();
  });

  it("gives each record a stable avatar colour", () => {
    expect(avatarColorFor("abc")).toBe(avatarColorFor("abc"));
  });
});
