import { describe, expect, it } from "vitest";
import {
  appointmentScopeFilter,
  assertBranchAccess,
  assertRecordAccess,
  createAuthService,
  homeFor,
  noMembershipDestination,
  requirePermission,
  resolveTenantContext,
  type AuthDeps,
  type Identity,
  type MembershipRecord,
} from "./authorize";
import { AuthError, type AuthErrorCode } from "./errors";

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const BRANCH_A1 = "branch-a1";
const BRANCH_A2 = "branch-a2";

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    id: `m-${Math.random()}`,
    clinicId: CLINIC_A,
    clinicName: "Aarogya",
    clinicStatus: "ACTIVE",
    branchId: null,
    roleKey: "RECEPTIONIST",
    status: "ACTIVE",
    permissions: ["patient.view", "appointment.view", "billing.view"],
    ...overrides,
  };
}

function identity(memberships: MembershipRecord[], overrides: Partial<Identity> = {}): Identity {
  return { userId: "user-1", authUserId: "auth-1", email: "r@example.com", name: "Receptionist", status: "ACTIVE", memberships, ...overrides };
}

function service(overrides: Partial<AuthDeps> & { identity?: Identity | null } = {}) {
  const { identity: id = identity([membership()]), ...deps } = overrides;
  return createAuthService({
    isConfigured: () => true,
    getAuthUser: async () => ({ status: "ok", user: { id: "auth-1", email: "r@example.com", emailConfirmed: true } }),
    loadIdentity: async () => id,
    ...deps,
  });
}

async function expectCode(promise: Promise<unknown> | (() => unknown), code: AuthErrorCode) {
  const run = typeof promise === "function" ? Promise.resolve().then(promise) : promise;
  await expect(run).rejects.toMatchObject({ name: "AuthError", code });
}

describe("authentication", () => {
  it("refuses everything when auth is not configured (missing env)", async () => {
    let looked = false;
    const svc = service({ isConfigured: () => false, getAuthUser: async () => ((looked = true), { status: "none" }) });
    await expectCode(svc.requireStaffContext(), "AUTH_NOT_CONFIGURED");
    expect(looked).toBe(false);
  });

  it("rejects unauthenticated requests", async () => {
    await expectCode(service({ getAuthUser: async () => ({ status: "none" }) }).requireStaffContext(), "UNAUTHENTICATED");
  });

  it("reports invalid or expired sessions distinctly", async () => {
    await expectCode(service({ getAuthUser: async () => ({ status: "expired" }) }).requireStaffContext(), "SESSION_EXPIRED");
  });

  it("rejects a valid login with no linked application user", async () => {
    await expectCode(service({ identity: null }).requireStaffContext(), "NOT_PROVISIONED");
  });

  it("rejects an identity that doesn't belong to the verified session", async () => {
    await expectCode(service({ identity: identity([membership()], { authUserId: "someone-else" }) }).requireIdentity(), "UNAUTHENTICATED");
  });

  it("rejects disabled accounts", async () => {
    await expectCode(service({ identity: identity([membership()], { status: "DISABLED" }) }).requireStaffContext(), "ACCOUNT_DISABLED");
  });

  it("maps auth errors to HTTP statuses", () => {
    expect(new AuthError("UNAUTHENTICATED").status).toBe(401);
    expect(new AuthError("SESSION_EXPIRED").status).toBe(401);
    expect(new AuthError("FORBIDDEN").status).toBe(403);
    expect(new AuthError("NOT_FOUND").status).toBe(404);
    expect(new AuthError("AUTH_NOT_CONFIGURED").status).toBe(503);
  });
});

describe("clinic membership", () => {
  it("rejects users without any clinic membership", async () => {
    await expectCode(service({ identity: identity([]) }).requireStaffContext(), "NO_MEMBERSHIP");
  });

  it("ignores inactive memberships and suspended clinics", async () => {
    await expectCode(service({ identity: identity([membership({ status: "INACTIVE" })]) }).requireStaffContext(), "NO_MEMBERSHIP");
    await expectCode(service({ identity: identity([membership({ clinicStatus: "SUSPENDED" })]) }).requireStaffContext(), "NO_MEMBERSHIP");
  });

  it("keeps patients out of staff context, and lets them into the portal only", async () => {
    const patient = identity([membership({ roleKey: "PATIENT", permissions: ["own_appointments.view"] })]);
    await expectCode(service({ identity: patient }).requireStaffContext(), "NO_MEMBERSHIP");
    await expect(service({ identity: patient }).requirePatientIdentity()).resolves.toMatchObject({ userId: "user-1" });
    await expectCode(service().requirePatientIdentity(), "NO_MEMBERSHIP");
    expect(homeFor(patient)).toBe("portal");
    expect(homeFor(identity([membership()]))).toBe("staff");
  });

  it("succeeds within the user's clinic and carries only that clinic's permissions", async () => {
    const id = identity([
      membership({ clinicId: CLINIC_A, clinicName: "Aarogya", permissions: ["patient.view"] }),
      membership({ clinicId: CLINIC_B, clinicName: "Nirmaya", roleKey: "ADMINISTRATOR", permissions: ["billing.manage"] }),
    ]);
    const ctx = await service({ identity: id }).requireStaffContext();
    expect(ctx).toMatchObject({ clinicId: CLINIC_A, branchId: null, userId: "user-1", roles: ["RECEPTIONIST"] });
    expect(ctx.permissions.has("patient.view")).toBe(true);
    expect(ctx.permissions.has("billing.manage")).toBe(false); // granted in clinic B only
  });

  it("honours a clinic preference only where the user is a member", async () => {
    const id = identity([membership({ clinicId: CLINIC_A, clinicName: "Aarogya" }), membership({ clinicId: CLINIC_B, clinicName: "Nirmaya" })]);
    expect(resolveTenantContext(id, CLINIC_B).clinicId).toBe(CLINIC_B);
    expect(() => resolveTenantContext(identity([membership()]), CLINIC_B)).toThrow(expect.objectContaining({ code: "CLINIC_FORBIDDEN" }));
  });

  it("falls back to the default clinic when a stale/forged clinic cookie names another clinic", async () => {
    const ctx = await service({ getRequestedClinicId: async () => CLINIC_B }).requireStaffContext();
    expect(ctx.clinicId).toBe(CLINIC_A);
  });
});

describe("roles and permissions", () => {
  it("rejects a role lacking the required permission", async () => {
    await expectCode(service().requireStaffContext({ permission: "role.manage" }), "FORBIDDEN");
    const ctx = resolveTenantContext(identity([membership()]));
    expect(() => requirePermission(ctx, ["staff.manage", "user.create"])).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("accepts when ANY listed permission is held, and an empty list needs none", async () => {
    await expect(service().requireStaffContext({ permission: ["role.manage", "billing.view"] })).resolves.toBeTruthy();
    const ctx = resolveTenantContext(identity([membership({ permissions: [] })]));
    expect(() => requirePermission(ctx, [])).not.toThrow();
  });

  it("merges permissions from several roles in the same clinic", () => {
    const ctx = resolveTenantContext(
      identity([membership({ roleKey: "DOCTOR", permissions: ["prescription.create"] }), membership({ roleKey: "ADMINISTRATOR", permissions: ["role.manage"] })])
    );
    expect([...ctx.permissions].sort()).toEqual(["prescription.create", "role.manage"]);
    expect(ctx.roles.sort()).toEqual(["ADMINISTRATOR", "DOCTOR"]);
  });
});

describe("tenant and branch isolation", () => {
  const clinicWide = resolveTenantContext(identity([membership()]));
  const branchOnly = resolveTenantContext(identity([membership({ branchId: BRANCH_A1 })]));

  it("treats another clinic's records as not found", () => {
    expect(() => assertRecordAccess(clinicWide, { clinicId: CLINIC_B, branchId: BRANCH_A1 })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => assertRecordAccess(clinicWide, null)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("returns records within the user's clinic", () => {
    const record = { clinicId: CLINIC_A, branchId: BRANCH_A2, id: "x" };
    expect(assertRecordAccess(clinicWide, record)).toBe(record);
  });

  it("restricts branch-scoped users to their branch", () => {
    expect(branchOnly.branchId).toBe(BRANCH_A1);
    expect(() => assertBranchAccess(branchOnly, BRANCH_A2)).toThrow(expect.objectContaining({ code: "BRANCH_FORBIDDEN" }));
    expect(() => assertBranchAccess(branchOnly, BRANCH_A1)).not.toThrow();
    expect(() => assertRecordAccess(branchOnly, { clinicId: CLINIC_A, branchId: BRANCH_A2 })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(assertRecordAccess(branchOnly, { clinicId: CLINIC_A, branchId: BRANCH_A1 })).toBeTruthy();
    // Clinic-wide records (e.g. patients) stay visible to branch staff.
    expect(assertRecordAccess(branchOnly, { clinicId: CLINIC_A, branchId: null })).toBeTruthy();
  });

  it("lets clinic-wide users act on any branch of their clinic", () => {
    expect(() => assertBranchAccess(clinicWide, BRANCH_A2)).not.toThrow();
  });

  it("uses clinic-wide scope if any membership in the clinic is clinic-wide", () => {
    const ctx = resolveTenantContext(identity([membership({ branchId: BRANCH_A1 }), membership({ roleKey: "DOCTOR", branchId: null })]));
    expect(ctx.branchId).toBeNull();
  });

  it("refuses ambiguous branch scopes rather than guessing", () => {
    expect(() => resolveTenantContext(identity([membership({ branchId: BRANCH_A1 }), membership({ roleKey: "NURSE", branchId: BRANCH_A2 })]))).toThrow(
      expect.objectContaining({ code: "MULTIPLE_BRANCH_SCOPES" })
    );
  });
});

describe("record-level scope", () => {
  it("gives a doctor with only own_* permissions an 'own' care scope bound to their profile", () => {
    const doctor = identity([membership({ roleKey: "DOCTOR", permissions: ["own_appointments.view", "assigned_patients.view"] })], {
      doctorProfiles: [{ id: "doc-1", clinicId: CLINIC_A }],
    });
    const ctx = resolveTenantContext(doctor);
    expect(ctx).toMatchObject({ careScope: "own", doctorId: "doc-1" });
    expect(appointmentScopeFilter(ctx)).toEqual({ doctorId: "doc-1" });
  });

  it("ignores doctor profiles from other clinics", () => {
    const ctx = resolveTenantContext(
      identity([membership({ roleKey: "DOCTOR", permissions: ["own_appointments.view"] })], { doctorProfiles: [{ id: "doc-b", clinicId: CLINIC_B }] })
    );
    expect(ctx.doctorId).toBeNull();
    expect(ctx.careScope).toBe("none");
    expect(() => appointmentScopeFilter(ctx)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("gives clinic-wide appointment roles an unfiltered scope", () => {
    const ctx = resolveTenantContext(identity([membership()]));
    expect(ctx.careScope).toBe("clinic");
    expect(appointmentScopeFilter(ctx)).toEqual({});
  });
});

describe("patient portal context", () => {
  const patientMembership = membership({ roleKey: "PATIENT", permissions: ["billing.view", "own_appointments.view"] });

  it("scopes a patient to the records an administrator linked to them", async () => {
    const id = identity([patientMembership], { patientLinks: [{ patientId: "pt-1", clinicId: CLINIC_A }] });
    const ctx = await service({ identity: id }).requirePatientContext();
    expect(ctx).toMatchObject({ clinicId: CLINIC_A, patientIds: ["pt-1"] });
  });

  it("refuses a PATIENT membership with no linked record", async () => {
    await expectCode(service({ identity: identity([patientMembership]) }).requirePatientContext(), "NO_MEMBERSHIP");
  });

  it("ignores linked records in clinics without a PATIENT membership", async () => {
    const id = identity([patientMembership], { patientLinks: [{ patientId: "pt-b", clinicId: CLINIC_B }] });
    await expectCode(service({ identity: id }).requirePatientContext(), "NO_MEMBERSHIP");
  });

  it("never lets a patient's billing.view act as a staff permission", async () => {
    await expectCode(service({ identity: identity([patientMembership]) }).requireStaffContext({ permission: "billing.view" }), "NO_MEMBERSHIP");
  });

  it("ignores a clinic preference the patient isn't linked to", async () => {
    const id = identity([patientMembership], { patientLinks: [{ patientId: "pt-1", clinicId: CLINIC_A }] });
    const ctx = await service({ identity: id, getRequestedClinicId: async () => CLINIC_B }).requirePatientContext();
    expect(ctx.clinicId).toBe(CLINIC_A);
  });
});

describe("where a signed-in user without a staff membership goes", () => {
  const invitee = (overrides: Partial<Identity> = {}) => identity([], { verifiedEmail: "r@example.com", ...overrides });
  const counting = (n: number) => {
    const calls: string[] = [];
    const fn = async (who: Identity & { verifiedEmail: string }) => (calls.push(who.verifiedEmail), n);
    return { fn, calls };
  };

  it("a new invitee who just set their password goes to their invitation, not Access Denied", async () => {
    const lookup = counting(1);
    // The staff guard rejects them (no membership yet) …
    await expectCode(service({ identity: invitee() }).requireStaffContext(), "NO_MEMBERSHIP");
    // … and they are sent to accept the invitation, looked up by the verified email only.
    expect(await noMembershipDestination(invitee(), lookup.fn)).toBe("/invitations");
    expect(lookup.calls).toEqual(["r@example.com"]);
  });

  it("an unconfirmed email is never used to look up invitations", async () => {
    const lookup = counting(1);
    expect(await noMembershipDestination(invitee({ verifiedEmail: null }), lookup.fn)).toBeNull();
    expect(await noMembershipDestination(invitee({ verifiedEmail: undefined }), lookup.fn)).toBeNull();
    expect(lookup.calls).toEqual([]);
  });

  it("a disabled account is not offered invitations", async () => {
    const lookup = counting(1);
    expect(await noMembershipDestination(invitee({ status: "DISABLED" }), lookup.fn)).toBeNull();
    expect(lookup.calls).toEqual([]);
  });

  it("someone with no invitation keeps the normal Access Denied page", async () => {
    expect(await noMembershipDestination(invitee(), counting(0).fn)).toBeNull();
  });

  it("a failed lookup falls back to the normal flow instead of granting anything", async () => {
    expect(await noMembershipDestination(invitee(), async () => { throw new Error("db down"); })).toBeNull();
  });

  it("patients still go to the portal; a patient with a staff invitation is offered it first", async () => {
    const patient = identity([membership({ roleKey: "PATIENT", permissions: [] })], { verifiedEmail: "r@example.com" });
    expect(await noMembershipDestination(patient, counting(0).fn)).toBe("/portal");
    expect(await noMembershipDestination(patient, counting(1).fn)).toBe("/invitations");
  });
});
