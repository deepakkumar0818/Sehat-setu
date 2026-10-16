import { describe, expect, it } from "vitest";
import { AuthError } from "@/server/auth/errors";
import { DataError } from "@/server/api/errors";
import { canOfferArchive, createLabReportSchema, mapDocumentDbError, setLabValuesSchema, uploadFieldsSchema } from "./document-rules";

const dbError = (msg: string) => Object.assign(new Error("Invalid `prisma.$queryRaw()` invocation"), { meta: { message: `ERROR: ${msg}` } });
const caught = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
};

describe("database refusals → API errors", () => {
  it("maps permission and existence without revealing which", () => {
    expect(caught(() => mapDocumentDbError(dbError("patient document: NOT_PERMITTED")))).toMatchObject({ code: "FORBIDDEN" });
    expect(caught(() => mapDocumentDbError(dbError("lab report: NOT_FOUND")))).toBeInstanceOf(AuthError);
    expect(caught(() => mapDocumentDbError(dbError("lab report: NOT_FOUND")))).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
  it("maps business rules to specific codes", () => {
    const cases: [string, string, number][] = [
      ["patient document: RATE_LIMITED", "RATE_LIMITED", 429],
      ["patient document: INVALID_FILE", "UNSUPPORTED_FILE", 415],
      ["lab report: SHARED_LOCKED", "SHARED_LOCKED", 409],
      ["lab report: NOT_REVIEWED", "NOT_REVIEWED", 409],
      ["lab report: INVALID_TRANSITION", "INVALID_TRANSITION", 409],
      ["patient document: INVALID_BRANCH", "INVALID_INPUT", 400],
    ];
    for (const [msg, code, status] of cases) {
      const e = caught(() => mapDocumentDbError(dbError(msg)));
      expect(e, msg).toBeInstanceOf(DataError);
      expect(e, msg).toMatchObject({ code, status });
    }
  });
  it("rethrows anything else unchanged", () => {
    const other = new Error("connection reset");
    expect(caught(() => mapDocumentDbError(other))).toBe(other);
  });
});

describe("input validation", () => {
  it("upload fields: known categories, bounded title, uuids only", () => {
    expect(uploadFieldsSchema.parse({ category: "ID_PROOF", title: " Aadhaar " }).title).toBe("Aadhaar");
    expect(() => uploadFieldsSchema.parse({ category: "EXECUTABLE", title: "x" })).toThrow();
    expect(() => uploadFieldsSchema.parse({ category: "ID_PROOF", title: "" })).toThrow();
    expect(() => uploadFieldsSchema.parse({ category: "ID_PROOF", title: "x".repeat(201) })).toThrow();
    expect(() => uploadFieldsSchema.parse({ category: "LAB_REPORT", title: "x", labReportId: "../x" })).toThrow();
  });
  it("lab values: strict keys, known flags, at most 100 rows of 120-character cells", () => {
    expect(setLabValuesSchema.parse({ values: [{ parameter: "Hb", value: "13.1", unit: "g/dL", range: "12-16", flag: "normal" }] }).values).toHaveLength(1);
    expect(() => setLabValuesSchema.parse({ values: [{ parameter: "Hb", dose: "1" }] })).toThrow();
    expect(() => setLabValuesSchema.parse({ values: [{ parameter: "Hb", flag: "critical" }] })).toThrow();
    expect(() => setLabValuesSchema.parse({ values: [{ parameter: "" }] })).toThrow();
    expect(() => setLabValuesSchema.parse({ values: [{ parameter: "x".repeat(121) }] })).toThrow();
    expect(() => setLabValuesSchema.parse({ values: Array.from({ length: 101 }, () => ({ parameter: "x" })) })).toThrow();
    expect(() => setLabValuesSchema.parse({ values: [], resultDate: "14/10/2026" })).toThrow();
  });
  it("lab report creation needs a test and title (numbering is not used)", () => {
    expect(() => createLabReportSchema.parse({ patientId: "11111111-1111-4111-8111-111111111111", testType: "", title: "x" })).toThrow();
    expect(createLabReportSchema.parse({ patientId: "11111111-1111-4111-8111-111111111111", testType: "CBC", title: "CBC" })).not.toHaveProperty("number");
  });
});

describe("archive hint (mirrors app.archive_patient_document)", () => {
  const me = { userId: "u1", doctorId: null as string | null };
  const now = new Date("2026-10-14T10:00:00Z");
  const doc = (over: Partial<Parameters<typeof canOfferArchive>[2]> = {}) => ({ category: "ID_PROOF" as const, status: "AVAILABLE", uploadedByUserId: "u2", uploadedAt: new Date("2026-10-14T09:00:00Z"), ...over });
  it("administrative files: patient_document.manage only", () => {
    expect(canOfferArchive(new Set(["patient_document.manage"]), me, doc(), now)).toBe(true);
    expect(canOfferArchive(new Set(["patient_document.upload", "patient_document.view"]), me, doc(), now)).toBe(false);
  });
  it("clinical files: lab/medical-record managers, or the uploading doctor within 24 hours", () => {
    expect(canOfferArchive(new Set(["lab.manage"]), me, doc({ category: "LAB_REPORT" }), now)).toBe(true);
    expect(canOfferArchive(new Set(["patient_document.manage"]), me, doc({ category: "IMAGING" }), now)).toBe(false);
    const dr = { userId: "u2", doctorId: "d1" };
    expect(canOfferArchive(new Set(["patient.medical_record.view"]), dr, doc({ category: "IMAGING" }), now)).toBe(true);
    expect(canOfferArchive(new Set(["patient.medical_record.view"]), dr, doc({ category: "IMAGING", uploadedAt: new Date("2026-10-13T09:00:00Z") }), now)).toBe(false);
  });
  it("never for archived files", () => {
    expect(canOfferArchive(new Set(["patient_document.manage"]), me, doc({ status: "ARCHIVED" }), now)).toBe(false);
  });
});
