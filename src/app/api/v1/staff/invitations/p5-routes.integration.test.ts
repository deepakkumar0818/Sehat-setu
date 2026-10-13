import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import { adminClient, contextFor } from "@/test/live-fixtures";
import { demoId } from "../../../../../../prisma/seed/demo-data";
import { AuthError } from "@/server/auth/errors";
import { requirePermission, type Identity, type TenantContext } from "@/server/auth/authorize";

// The P5 route handlers (staff, doctors, specialties, invitations, notifications,
// /me/invitations) through apiRoute/identityRoute and the real data modules, as
// fixture users. Only the session lookup is replaced. Nothing is written: every
// request here is either a read or refused before any database write. Requests
// that would create an invitation (and email it) run ONLY while the P5
// migration is not applied, where they are refused as FEATURE_UNAVAILABLE.

let signedIn: TenantContext | null = null;
let identity: (Identity & { verifiedEmail?: string | null }) | null = null;
vi.mock("@/server/auth/session", () => ({
  requireStaff: async (permission: string | readonly string[]) => {
    if (!signedIn) throw new AuthError("UNAUTHENTICATED");
    requirePermission(signedIn, permission);
    return signedIn;
  },
  requireIdentity: async () => {
    if (!identity) throw new AuthError("UNAUTHENTICATED");
    return identity;
  },
  ACTIVE_CLINIC_COOKIE: "sehat_active_clinic",
}));

const staffRoute = await import("../route");
const staffMemberRoute = await import("../[id]/route");
const doctorsRoute = await import("../../doctors/route");
const specialtiesRoute = await import("../../specialties/route");
const invitationsRoute = await import("./route");
const resendRoute = await import("./[id]/resend/route");
const notificationsRoute = await import("../../notifications/route");
const unreadRoute = await import("../../notifications/unread-count/route");
const readAllRoute = await import("../../notifications/read-all/route");
const myInvitationsRoute = await import("../../me/invitations/route");
const acceptRoute = await import("../../me/invitations/[id]/accept/route");

// Decided before tests are collected: the create-and-email requests below must never run once the migration exists.
const probe = adminClient();
await probe.connect();
// "tables": the P5 migrations are applied. "ready": also the create-function fix (20261019000200, marker P5-FIX-1)
// and the phone number (20261020000000, marker P5-PHONE-1).
const tables = Boolean((await probe.query(`SELECT to_regclass('public.staff_invitations') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL AS ok`)).rows[0].ok);
const ready = Boolean((await probe.query(`SELECT coalesce((SELECT position('P5-FIX-1' IN prosrc) > 0 AND position('P5-PHONE-1' IN prosrc) > 0 FROM pg_proc WHERE oid = to_regprocedure('app.create_staff_invitation(text, text, text, uuid, text, uuid, text, text, integer, integer, boolean)')), false) AS ok`)).rows[0].ok) && tables;
const applied = tables;
// Edit phone (20261020000100, app.set_staff_phone, marker P5-PHONE-EDIT-1).
const phoneEditReady = Boolean((await probe.query(`SELECT coalesce((SELECT position('P5-PHONE-EDIT-1' IN prosrc) > 0 FROM pg_proc WHERE oid = to_regprocedure('app.set_staff_phone(uuid, text)')), false) AS ok`)).rows[0].ok);
await probe.end();

let admin: Client;
let adminA: TenantContext, managerWakad: TenantContext, receptionWakad: TenantContext, doctor1: TenantContext;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route handlers differ only in their params shape
type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>;
async function call(handler: Handler, url: string, init?: { method?: string; body?: unknown; params?: Record<string, string> }) {
  const req = new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
  const res = await handler(req, { params: Promise.resolve(init?.params ?? {}) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  admin = adminClient();
  await admin.connect();
  adminA = await contextFor(admin, "ST-01");
  managerWakad = await contextFor(admin, "ST-02");
  receptionWakad = await contextFor(admin, "ST-04");
  doctor1 = await contextFor(admin, "DR-01");
});

afterAll(async () => {
  await admin?.end();
  const { prisma } = await import("@/server/prisma");
  await prisma.$disconnect();
});

const validNurse = { email: "zztest.route@example.com", name: "ZZTEST Route", roleKey: "NURSE", branchId: demoId("branch:AAR-WKD"), phone: "+91 98000 00001" };

describe("staff directory capabilities", () => {
  it("administrators may change others' status but never their own", async () => {
    signedIn = adminA;
    const res = await call(staffRoute.GET as Handler, "/api/v1/staff?pageSize=50");
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual({ canChangeStatus: true, canInvite: true, canViewInvitations: true, invitationsReady: ready, canEditPhone: phoneEditReady });
    const own = res.body.items.find((m: { email: string }) => m.email === adminA.email);
    expect(own?.canChangeStatus).toBe(false);
    expect(res.body.items.filter((m: { email: string }) => m.email !== adminA.email).every((m: { canChangeStatus: boolean }) => m.canChangeStatus)).toBe(true);
  });

  it("clinic managers: view invitations, can't invite, change status only within their branch", async () => {
    signedIn = managerWakad;
    const res = await call(staffRoute.GET as Handler, "/api/v1/staff?pageSize=50");
    expect(res.body.capabilities).toEqual({ canChangeStatus: true, canInvite: false, canViewInvitations: true, invitationsReady: ready, canEditPhone: false });
    for (const m of res.body.items as { branchId: string; email: string; canChangeStatus: boolean; canEditPhone: boolean }[]) {
      expect(m.canChangeStatus, m.email).toBe(m.email !== managerWakad.email && m.branchId === managerWakad.branchId);
      expect(m.canEditPhone, m.email).toBe(false); // phone editing is for Administrators only
    }
  });
});

// PATCH { phone }. Only requests that are refused before (or by) the database run
// here, because route handlers commit: successful edits are tested rolled back in
// src/server/data/staff-phone.integration.test.ts.
describe("edit phone (PATCH /api/v1/staff/[id] { phone })", () => {
  const receptionMembership = async () =>
    (await admin.query(`SELECT id FROM clinic_memberships WHERE "userId" = $1 AND "clinicId" = $2`, [demoId("user:ST-04"), demoId("clinic:AAR")])).rows[0].id as string;
  const patch = (id: string, body: unknown) => call(staffMemberRoute.PATCH as Handler, `/api/v1/staff/${id}`, { method: "PATCH", body, params: { id } });

  it("401 signed out; 403 for Clinic Managers, Receptionists, Doctors and patients (not Administrators)", async () => {
    const id = await receptionMembership();
    signedIn = null;
    expect((await patch(id, { phone: "+91 98000 00001" })).status).toBe(401);
    // A patient-portal user forcing a staff-shaped context still holds no staff permissions.
    const patientLike: TenantContext = { ...adminA, roles: ["PATIENT"], permissions: new Set<string>(), name: "Patient" };
    for (const who of [managerWakad, receptionWakad, doctor1, patientLike]) {
      signedIn = who;
      const res = await patch(id, { phone: "+91 98000 00001" });
      expect(res.status, who.name).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain("98000");
    }
  });

  it("400 for an invalid or missing phone, or a body mixing status and phone — the number is never echoed", async () => {
    const id = await receptionMembership();
    signedIn = adminA;
    for (const body of [{ phone: "" }, { phone: "98000 00001" }, { phone: "+91 18000 00001" }, { phone: "+91 98000 0000x" }, { phone: 9800000001 }, { phone: "+91 98000 00001", status: "active" }]) {
      const res = await patch(id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
      expect(JSON.stringify(res.body)).not.toMatch(/98000|18000/);
    }
  });

  it.runIf(!phoneEditReady)("before migration 20261020000100: 503 'not set up', nothing changes", async () => {
    const id = await receptionMembership();
    const before = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [demoId("user:ST-04")])).rows[0].phone;
    signedIn = adminA;
    const res = await patch(id, { phone: "+91 98000 00001" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("FEATURE_UNAVAILABLE");
    expect((await admin.query(`SELECT phone FROM users WHERE id = $1`, [demoId("user:ST-04")])).rows[0].phone).toBe(before);
  });

  it.runIf(phoneEditReady)("another clinic's administrator gets 404 (no write)", async () => {
    const id = await receptionMembership();
    signedIn = await contextFor(admin, "ST-07");
    const res = await patch(id, { phone: "+91 98000 00001" });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("98000");
  });
});

describe("doctors and specialties", () => {
  it("only administrators get the doctor-invite capability", async () => {
    signedIn = adminA;
    expect((await call(doctorsRoute.GET as Handler, "/api/v1/doctors")).body.capabilities).toEqual({ canInviteDoctors: true, invitationsReady: ready });
    signedIn = managerWakad;
    expect((await call(doctorsRoute.GET as Handler, "/api/v1/doctors")).body.capabilities).toEqual({ canInviteDoctors: false, invitationsReady: false });
  });

  it("the specialty list comes from the database", async () => {
    const truth = (await admin.query(`SELECT name FROM specialties ORDER BY name, id`)).rows.map((r) => r.name);
    signedIn = receptionWakad;
    const res = await call(specialtiesRoute.GET as Handler, "/api/v1/specialties");
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { name: string }) => s.name)).toEqual(truth);
    signedIn = null;
    expect((await call(specialtiesRoute.GET as Handler, "/api/v1/specialties")).status).toBe(401);
  });
});

describe("staff invitation routes", () => {
  it("401 signed out; 403 for everyone but administrators (create); 403 for staff without view rights (list)", async () => {
    signedIn = null;
    expect((await call(invitationsRoute.POST as Handler, "/api/v1/staff/invitations", { method: "POST", body: validNurse })).status).toBe(401);
    for (const ctx of [managerWakad, receptionWakad, doctor1]) {
      signedIn = ctx;
      const res = await call(invitationsRoute.POST as Handler, "/api/v1/staff/invitations", { method: "POST", body: validNurse });
      expect(res.status, ctx.name).toBe(403);
    }
    signedIn = receptionWakad;
    expect((await call(invitationsRoute.GET as Handler, "/api/v1/staff/invitations")).status).toBe(403);
    signedIn = managerWakad;
    expect((await call(resendRoute.POST as Handler, "/api/v1/staff/invitations/x/resend", { method: "POST", params: { id: "x" } })).status).toBe(403);
  });

  it("400 for invalid input before anything reaches the database", async () => {
    signedIn = adminA;
    for (const bad of [
      { ...validNurse, roleKey: "ADMINISTRATOR" },
      { ...validNurse, roleKey: "PATIENT" },
      { ...validNurse, branchId: undefined },
      { ...validNurse, email: "not-an-email" },
      { ...validNurse, clinicId: demoId("clinic:NIR") },
      { ...validNurse, roleKey: "DOCTOR" },
      { ...validNurse, phone: undefined },
      { ...validNurse, phone: "" },
      { ...validNurse, phone: "98000 00001" }, // no country code
      { ...validNurse, phone: "+91 18000 00001" }, // not a valid Indian number
      { ...validNurse, phone: "+91 98000 0000" }, // too short
      { ...validNurse, phone: "+91 98000 0000x" },
    ]) {
      const res = await call(invitationsRoute.POST as Handler, "/api/v1/staff/invitations", { method: "POST", body: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
      // The error names the field, never the number entered.
      expect(JSON.stringify(res.body)).not.toMatch(/98000|18000/);
    }
  });

  it.runIf(!ready)("until the invitation migrations and fix are applied: 503 FEATURE_UNAVAILABLE, nothing created or emailed", async () => {
    signedIn = adminA;
    const list = await call(invitationsRoute.GET as Handler, "/api/v1/staff/invitations");
    if (tables) expect(list.status).toBe(200);
    else expect(list.body.error.code).toBe("FEATURE_UNAVAILABLE");
    const create = await call(invitationsRoute.POST as Handler, "/api/v1/staff/invitations", { method: "POST", body: validNurse });
    expect(create.status).toBe(503);
    expect(create.body.error.code).toBe("FEATURE_UNAVAILABLE");
    expect((await admin.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [validNurse.email])).rows[0].n).toBe(0);
  });
});

describe("notification routes", () => {
  it("401 signed out; 400 for a bad mark-all cutoff", async () => {
    signedIn = null;
    expect((await call(notificationsRoute.GET as Handler, "/api/v1/notifications")).status).toBe(401);
    signedIn = adminA;
    const bad = await call(readAllRoute.POST as Handler, "/api/v1/notifications/read-all", { method: "POST", body: { before: "yesterday" } });
    expect(bad.status).toBe(400);
  });

  it.runIf(!applied)("before the migration: 503 FEATURE_UNAVAILABLE (the UI shows 'not available', never fake data)", async () => {
    signedIn = adminA;
    for (const handler of [notificationsRoute.GET, unreadRoute.GET] as Handler[]) {
      const res = await call(handler, "/api/v1/notifications");
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("FEATURE_UNAVAILABLE");
    }
  });
});

describe("invitee routes (/api/v1/me/invitations)", () => {
  const baseIdentity = (): Identity & { verifiedEmail: string | null } => ({
    userId: demoId("user:ST-04"), authUserId: "test-ST-04", email: "x@example.com", name: "X", status: "ACTIVE", memberships: [], verifiedEmail: "x@example.com",
  });

  it("401 signed out; 403 until the email is confirmed; 403 for a disabled account", async () => {
    identity = null;
    expect((await call(myInvitationsRoute.GET as Handler, "/api/v1/me/invitations")).status).toBe(401);
    identity = { ...baseIdentity(), verifiedEmail: null };
    const unverified = await call(myInvitationsRoute.GET as Handler, "/api/v1/me/invitations");
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe("EMAIL_NOT_VERIFIED");
    identity = { ...baseIdentity(), status: "DISABLED" };
    expect((await call(myInvitationsRoute.GET as Handler, "/api/v1/me/invitations")).status).toBe(403);
  });

  it("404 for a malformed invitation id (nothing reaches the database)", async () => {
    identity = baseIdentity();
    const res = await call(acceptRoute.POST as Handler, "/api/v1/me/invitations/nope/accept", { method: "POST", params: { id: "nope" } });
    expect(res.status).toBe(404);
  });

  it.runIf(!applied)("before the migration: 503 FEATURE_UNAVAILABLE", async () => {
    identity = baseIdentity();
    const res = await call(myInvitationsRoute.GET as Handler, "/api/v1/me/invitations");
    expect(res.status).toBe(503);
  });
});
