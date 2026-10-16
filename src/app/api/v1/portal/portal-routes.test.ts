import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthError } from "@/server/auth/errors";
import type { PatientContext } from "@/server/auth/authorize";

// Portal routes WITHOUT a database: the patient session and the data functions
// are stubbed, so this checks the HTTP contract — who gets in, which status
// codes come back, that errors are JSON without file bytes, the download
// headers, and that no patient id is taken from the request. Database
// behaviour: portal.integration.test.ts.

vi.mock("server-only", () => ({}));

const session = vi.hoisted(() => ({ next: null as null | (() => Promise<PatientContext>) }));
vi.mock("@/server/auth/session", () => ({
  requirePatient: async () => {
    if (!session.next) throw new AuthError("UNAUTHENTICATED");
    return session.next();
  },
  requireStaff: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
  requireIdentity: async () => {
    throw new AuthError("UNAUTHENTICATED");
  },
}));

const data = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown[] }[], file: null as null | (() => Promise<unknown>) }));
vi.mock("@/server/data/portal", () => ({
  listMyLabReports: async (...args: unknown[]) => (data.calls.push({ fn: "listMyLabReports", args }), { items: [], total: 0, page: 1, pageSize: 20 }),
  getMyLabReport: async (...args: unknown[]) => {
    data.calls.push({ fn: "getMyLabReport", args });
    throw new AuthError("NOT_FOUND");
  },
  listMyDocuments: async () => ({ items: [], total: 0, page: 1, pageSize: 30 }),
  getPortalSummary: async () => ({ clinicName: "C", patient: null, reportCount: 0, documentCount: 0, latestReports: [] }),
}));
vi.mock("@/server/data/documents", () => ({ openPatientDocumentFile: async () => data.file!() }));

const reports = await import("./lab-reports/route");
const report = await import("./lab-reports/[id]/route");
const file = await import("./documents/[id]/file/route");

const ID = "33333333-3333-4333-8333-333333333333";
const patient: PatientContext = { authUserId: "a", userId: "u", email: "p@example.test", name: "P", clinicId: "c", clinicName: "C", patientIds: ["pt-1"] };
const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  session.next = null;
  data.calls = [];
  data.file = null;
});

describe("/api/v1/portal", () => {
  it("401 without a session or with an expired one; 403 for staff-only and unlinked accounts — always JSON", async () => {
    const list = () => reports.GET(new NextRequest("http://localhost/api/v1/portal/lab-reports"), { params: Promise.resolve({}) });
    let res = await list();
    expect(res.status).toBe(401);
    session.next = async () => { throw new AuthError("SESSION_EXPIRED"); };
    res = await list();
    expect([res.status, (await res.json()).error.code]).toEqual([401, "SESSION_EXPIRED"]);
    session.next = async () => { throw new AuthError("NO_MEMBERSHIP"); }; // e.g. a staff account
    expect((await list()).status).toBe(403);
    session.next = async () => { throw new AuthError("PATIENT_NOT_LINKED"); };
    res = await list();
    const body = await res.json();
    expect([res.status, body.error.code]).toEqual([403, "PATIENT_NOT_LINKED"]);
    expect(body.error.message).not.toMatch(/AAR-P|patient number|record \w+-\d/i); // says nothing about which records exist
    expect(data.calls).toEqual([]);
  });

  it("hands the data layer the server-side patient context, whatever the query string says", async () => {
    session.next = async () => patient;
    await reports.GET(new NextRequest(`http://localhost/api/v1/portal/lab-reports?patientId=someone-else&clinicId=other`), { params: Promise.resolve({}) });
    expect(data.calls[0].args[0]).toBe(patient);
    // portal.ts reads only page/pageSize from the query (guarded in live-data.test.ts), and the database derives the
    // patient from the link even for a tampered context (portal.integration.test.ts).
  });

  it("an unavailable report is a JSON 404 that looks like any unknown id", async () => {
    session.next = async () => patient;
    const res = await report.GET(new NextRequest(`http://localhost/api/v1/portal/lab-reports/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "NOT_FOUND", message: "Not found." });
  });

  it("files: JSON 404 without bytes when refused; safe headers when allowed", async () => {
    session.next = async () => patient;
    data.file = async () => { throw new AuthError("NOT_FOUND"); };
    let res = await file.GET(new NextRequest(`http://localhost/api/v1/portal/documents/${ID}/file`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-disposition")).toBeNull();
    const bytes = enc("%PDF-1.4\n%%EOF\n");
    data.file = async () => ({ bytes, mimeType: "application/pdf", filename: "cbc.pdf", disposition: "attachment" });
    res = await file.GET(new NextRequest(`http://localhost/api/v1/portal/documents/${ID}/file`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox;/);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="cbc.pdf"');
  });
});
