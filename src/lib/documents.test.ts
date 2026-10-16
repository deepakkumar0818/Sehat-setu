import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, asciiFilename, checkDocumentBytes, isClinicalCategory, sanitizeFilename, sniffMimeType } from "./documents";

// Synthetic files only (no real documents).
const enc = (s: string) => new TextEncoder().encode(s);
export const PDF = enc("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
export const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe("sniffMimeType (magic bytes, never names)", () => {
  it("recognises PDF, JPEG and PNG", () => {
    expect(sniffMimeType(PDF)).toBe("application/pdf");
    expect(sniffMimeType(PNG)).toBe("image/png");
    expect(sniffMimeType(JPEG)).toBe("image/jpeg");
  });
  it("rejects everything else", () => {
    for (const bytes of [EXE, enc("<!doctype html><script>alert(1)</script>"), enc('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), enc("GIF89a"), enc("PK\u0003\u0004"), new Uint8Array()]) {
      expect(sniffMimeType(bytes)).toBeNull();
    }
  });
});

describe("checkDocumentBytes", () => {
  it("accepts valid files whose name and declared type agree with the bytes", () => {
    expect(checkDocumentBytes(PDF, "application/pdf", "report.pdf")).toEqual({ ok: true, mimeType: "application/pdf" });
    expect(checkDocumentBytes(PNG, "image/png", "scan.PNG")).toEqual({ ok: true, mimeType: "image/png" });
    expect(checkDocumentBytes(JPEG, "image/jpg", "photo.jpeg")).toEqual({ ok: true, mimeType: "image/jpeg" });
    expect(checkDocumentBytes(JPEG, "", "photo.jpg")).toEqual({ ok: true, mimeType: "image/jpeg" }); // browsers sometimes send no type
  });
  it("rejects empty and oversized files", () => {
    expect(checkDocumentBytes(new Uint8Array(), "application/pdf", "a.pdf")).toEqual({ ok: false, reason: "empty" });
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF);
    expect(checkDocumentBytes(big, "application/pdf", "a.pdf")).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects disguised executables, HTML and SVG", () => {
    expect(checkDocumentBytes(EXE, "application/pdf", "invoice.pdf")).toEqual({ ok: false, reason: "unsupported_type" });
    expect(checkDocumentBytes(enc("<html><body>x</body></html>"), "application/pdf", "report.pdf")).toEqual({ ok: false, reason: "unsupported_type" });
    expect(checkDocumentBytes(enc("<svg onload=alert(1)>"), "image/png", "scan.png")).toEqual({ ok: false, reason: "unsupported_type" });
  });
  it("rejects type mismatches between bytes, declared type and extension", () => {
    expect(checkDocumentBytes(PNG, "application/pdf", "scan.png")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(checkDocumentBytes(PNG, "image/png", "scan.pdf")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(checkDocumentBytes(PDF, "application/pdf", "report")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(checkDocumentBytes(PDF, "text/html", "report.pdf")).toEqual({ ok: false, reason: "type_mismatch" });
  });
  it("rejects PDFs with scripts or launch actions, and truncated files", () => {
    expect(checkDocumentBytes(enc("%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF"), "application/pdf", "a.pdf")).toEqual({ ok: false, reason: "active_content" });
    expect(checkDocumentBytes(enc("%PDF-1.4\n<< /S /Launch /F (cmd.exe) >>\n%%EOF"), "application/pdf", "a.pdf")).toEqual({ ok: false, reason: "active_content" });
    expect(checkDocumentBytes(enc("%PDF-1.4\n<< /Type /Catalog >>"), "application/pdf", "a.pdf")).toEqual({ ok: false, reason: "malformed" });
    expect(checkDocumentBytes(PNG.slice(0, 12), "image/png", "a.png")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("sanitizeFilename", () => {
  it("keeps only the last path segment and forces the real extension", () => {
    expect(sanitizeFilename("../../etc/passwd.pdf", "application/pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("C:\\Users\\x\\scan.png", "image/png")).toBe("scan.png");
    expect(sanitizeFilename("report.exe", "application/pdf")).toBe("report.pdf");
    expect(sanitizeFilename("photo.JPEG", "image/jpeg")).toBe("photo.jpg");
  });
  it("removes control, bidi and separator characters, collapses spaces, keeps Unicode letters", () => {
    expect(sanitizeFilename("a\u0000b\r\nc\u202e.pdf", "application/pdf")).toBe("abc.pdf");
    expect(sanitizeFilename("  रिपोर्ट   जून <script>.pdf", "application/pdf")).toBe("रिपोर्ट जून _script.pdf");
    expect(sanitizeFilename("...", "image/png")).toBe("document.png");
  });
  it("never exceeds 200 characters (the database limit)", () => {
    const out = sanitizeFilename(`${"x".repeat(500)}.pdf`, "application/pdf");
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
  it("produces names the database CHECK accepts (no / \\ or control characters)", () => {
    for (const raw of ["a/b.pdf", "a\\b.pdf", "x\u0007y.pdf", "\u0085z.pdf"]) expect(sanitizeFilename(raw, "application/pdf")).not.toMatch(/[/\\\u0000-\u001f\u007f-\u009f]/);
  });
  it("asciiFilename gives a header-safe fallback", () => {
    expect(asciiFilename('rép"ort;.pdf')).toBe("rep_ort_.pdf");
    expect(asciiFilename("रिपोर्ट")).toBe("document");
  });
});

describe("categories", () => {
  it("mirrors app.document_is_clinical", () => {
    for (const c of ["LAB_REPORT", "IMAGING", "DISCHARGE_SUMMARY", "REFERRAL", "CLINICAL_OTHER"] as const) expect(isClinicalCategory(c)).toBe(true);
    for (const c of ["ID_PROOF", "INSURANCE", "CONSENT", "ADMIN_OTHER"] as const) expect(isClinicalCategory(c)).toBe(false);
  });
});
