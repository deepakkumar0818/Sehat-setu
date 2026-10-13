import { describe, expect, it } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import {
  createInvitationSchema,
  deliveryState,
  invitationActions,
  invitationState,
  isMissingP5Schema,
  mapInvitationDbError,
  MAX_SEND_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  rupeesToPaise,
} from "./invitation-rules";

const branchId = "8f8f8f8f-1111-4222-8333-444444444444";
const specialtyId = "9a9a9a9a-1111-4222-8333-444444444444";
const PHONE = "+919876543210";
const doctor = { specialtyId, qualifications: "MBBS, MD", registrationNumber: "MH-12345", experienceYears: 8, consultationFee: 650.5, onlineConsultation: true };

describe("invitation input", () => {
  it("normalises email case/whitespace and the name", () => {
    const v = createInvitationSchema.parse({ email: "  Asha.Rao@Example.COM ", name: "  Asha   Rao ", roleKey: "NURSE", branchId, phone: "+91 98765-43210" });
    expect(v.email).toBe("asha.rao@example.com");
    expect(v.name).toBe("Asha Rao");
    expect(v.phone).toBe("+919876543210");
  });

  it("requires a valid phone number and stores it in E.164, without echoing it in errors", () => {
    const parse = (phone: unknown) => createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", roleKey: "NURSE", branchId, phone });
    for (const ok of ["+919876543210", "+91 98765 43210", "0091 98765 43210", "+1 (415) 555-2671", "+44 7911 123456", "+971 50 123 4567"]) {
      expect(parse(ok).success, ok).toBe(true);
    }
    for (const bad of [undefined, "", "   ", "9876543210", "+91 12345 67890", "+91 98765 4321", "+91 98765 432100", "+91 98765 4321x", "+0 1234567", "+1 555 0100", "x".repeat(41)]) {
      const r = parse(bad);
      expect(r.success, String(bad)).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path[0] === "phone"), String(bad)).toBe(true);
        expect(JSON.stringify(r.error.issues)).not.toMatch(/98765|12345|0100/);
      }
    }
  });

  it("only Doctor, Clinic Manager, Receptionist and Nurse are invitable", () => {
    for (const roleKey of ["DOCTOR", "CLINIC_MANAGER", "RECEPTIONIST", "NURSE"]) {
      const input = { email: "a@b.co", name: "A B", phone: PHONE, roleKey, branchId, ...(roleKey === "DOCTOR" ? { doctor } : {}) };
      expect(createInvitationSchema.safeParse(input).success, roleKey).toBe(true);
    }
    for (const roleKey of ["ADMINISTRATOR", "PATIENT", "SUPERADMIN", "doctor"]) {
      expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey, branchId }).success, roleKey).toBe(false);
    }
  });

  it("requires a branch for every role", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "NURSE" }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "NURSE", branchId: "wakad" }).success).toBe(false);
  });

  it("doctor details are required exactly for Doctor invitations", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "DOCTOR", branchId }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "NURSE", branchId, doctor }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "DOCTOR", branchId, doctor }).success).toBe(true);
  });

  it("rejects department/bio and other unknown fields (strict)", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "NURSE", branchId, clinicId: branchId }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "DOCTOR", branchId, doctor: { ...doctor, bio: "x" } }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "DOCTOR", branchId, doctor: { ...doctor, departmentId: specialtyId } }).success).toBe(false);
  });

  it("validates doctor fields and converts the fee to paise", () => {
    const bad = (patch: object) => createInvitationSchema.safeParse({ email: "a@b.co", name: "A B", phone: PHONE, roleKey: "DOCTOR", branchId, doctor: { ...doctor, ...patch } }).success;
    expect(bad({ experienceYears: 71 })).toBe(false);
    expect(bad({ experienceYears: 2.5 })).toBe(false);
    expect(bad({ consultationFee: -1 })).toBe(false);
    expect(bad({ consultationFee: 100_000.01 })).toBe(false);
    expect(bad({ consultationFee: 10.005 })).toBe(false);
    expect(bad({ registrationNumber: "ab" })).toBe(false);
    expect(bad({ qualifications: "M\u0000BBS" })).toBe(false);
    expect(rupeesToPaise(650.5)).toBe(65050);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
});

describe("derived invitation states", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  const row = (patch: object = {}) => ({
    status: "PENDING" as const,
    expiresAt: new Date("2026-10-20T10:00:00Z"),
    deliveryStatus: "SENT" as const,
    sendAttempts: 1,
    lastAttemptAt: new Date("2026-10-13T09:00:00Z"),
    ...patch,
  });

  it("pending vs expired vs accepted vs revoked", () => {
    expect(invitationState(row(), now)).toBe("pending");
    expect(invitationState(row({ expiresAt: now }), now)).toBe("expired");
    expect(invitationState(row({ status: "ACCEPTED", expiresAt: new Date(0) }), now)).toBe("accepted");
    expect(invitationState(row({ status: "REVOKED" }), now)).toBe("revoked");
  });

  it("a send in progress becomes 'unknown' after two minutes (never 'sent')", () => {
    expect(deliveryState(row({ deliveryStatus: "SENDING", lastAttemptAt: new Date(now.getTime() - 30_000) }), now)).toBe("sending");
    expect(deliveryState(row({ deliveryStatus: "SENDING", lastAttemptAt: new Date(now.getTime() - 3 * 60_000) }), now)).toBe("unknown");
    expect(deliveryState(row({ deliveryStatus: "FAILED" }), now)).toBe("failed");
  });

  it("resend: 2-minute cooldown, at most 10 sends, managers only; expired invitations can be renewed", () => {
    expect(invitationActions(row(), true, now)).toMatchObject({ canResend: true, canRevoke: true, resendAvailableAt: null });
    const recent = invitationActions(row({ lastAttemptAt: new Date(now.getTime() - 30_000) }), true, now);
    expect(recent.canResend).toBe(false);
    expect(recent.resendAvailableAt).toBe(new Date(now.getTime() - 30_000 + RESEND_COOLDOWN_MS).toISOString());
    expect(invitationActions(row({ sendAttempts: MAX_SEND_ATTEMPTS }), true, now).canResend).toBe(false);
    expect(invitationActions(row({ expiresAt: new Date(0) }), true, now).canResend).toBe(true);
    expect(invitationActions(row(), false, now)).toMatchObject({ canResend: false, canRevoke: false });
    expect(invitationActions(row({ status: "ACCEPTED" }), true, now)).toMatchObject({ canResend: false, canRevoke: false });
  });
});

describe("database refusals → API errors", () => {
  const raise = (message: string) => {
    try {
      mapInvitationDbError(Object.assign(new Error("Invalid `prisma.$queryRaw()` invocation"), { cause: new Error(message) }));
    } catch (err) {
      return err;
    }
  };

  it("maps every coded refusal", () => {
    expect(raise("staff invitation: NOT_PERMITTED")).toBeInstanceOf(AuthError);
    expect((raise("staff invitation: NOT_FOUND") as AuthError).code).toBe("NOT_FOUND");
    const dup = raise("staff invitation: ALREADY_INVITED 0f0f0f0f-1111-4222-8333-444444444444") as DataError;
    expect(dup.code).toBe("ALREADY_INVITED");
    expect(dup.details).toEqual({ invitationId: "0f0f0f0f-1111-4222-8333-444444444444" });
    for (const [code, status] of [
      ["ALREADY_PATIENT", 409], ["ALREADY_MEMBER", 409], ["REGISTRATION_IN_USE", 409], ["TOO_SOON", 429], ["RATE_LIMITED", 429],
      ["TOO_MANY_ATTEMPTS", 409], ["EXPIRED", 409], ["REVOKED", 409], ["DOCTOR_PROFILE_EXISTS", 409], ["EMAIL_MISMATCH", 403],
    ] as const) {
      const e = raise(`staff invitation: ${code}`) as DataError;
      expect(e.code, code).toBe(code);
      expect(e.status, code).toBe(status);
    }
    expect((raise("staff invitation: INVALID_BRANCH") as DataError).code).toBe("INVALID_INPUT");
  });

  it("never reveals another clinic's or user's details in messages", () => {
    const e = raise("staff invitation: DOCTOR_PROFILE_EXISTS") as DataError;
    expect(e.message).not.toMatch(/clinic [A-Z]|@/);
  });

  it("rethrows anything it doesn't recognise", () => {
    const original = new Error("connection reset");
    expect(raise.call(null, "connection reset")).toBeInstanceOf(Error);
    expect(() => mapInvitationDbError(original)).toThrow(original);
  });

  it("recognises a database without the P5 migration", () => {
    expect(isMissingP5Schema(new Error('relation "staff_invitations" does not exist'))).toBe(true);
    expect(isMissingP5Schema(new Error("function app.create_staff_invitation(text, text) does not exist"))).toBe(true);
    expect(isMissingP5Schema({ code: "P2021" })).toBe(true);
    expect(isMissingP5Schema(new Error('relation "patients" does not exist'))).toBe(false);
    expect((raise('relation "staff_invitations" does not exist') as DataError).code).toBe("FEATURE_UNAVAILABLE");
  });
});
