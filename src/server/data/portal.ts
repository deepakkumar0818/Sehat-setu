import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/server/auth/errors";
import type { PatientContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { LabValue } from "@/lib/documents";
import type { PortalDocument, PortalLabReport, PortalLabReportDetail, PortalSummary } from "@/lib/live-types";
import { lookupNames } from "./documents";
import { uuid } from "./document-rules";
import { pageArgs, runPatientScoped } from "./scope";

// Patient portal (P6.3): a signed-in patient's OWN reviewed, shared lab reports
// and those reports' result files. Nothing else.
//
// Who: PatientContext (verified session + ACTIVE PATIENT membership + a record
// an operator linked with `npm run auth:provision -- --role PATIENT --patient …`).
// The patient ids come only from that link, never from the browser.
// Where it's enforced: every query runs in the patient's own transaction, where
// RLS (lab_reports_read / patient_documents_read, migration 20261021000000)
// exposes only rows with status REVIEWED + sharedWithPatientAt set (reports) and
// AVAILABLE LAB_REPORT files of such reports (documents), for
// app.current_patient_ids(). Each query repeats that rule explicitly.
// What is returned: no internal notes, no staff user ids, no storage keys.
// Refusals are indistinguishable from "doesn't exist" (404).

/** The eligibility rule for a report a patient may see (mirrors lab_reports_read's patient clause). */
export function eligibleReportWhere(ctx: PatientContext): Prisma.LabReportWhereInput {
  return { clinicId: ctx.clinicId, patientId: { in: ctx.patientIds }, status: "REVIEWED", sharedWithPatientAt: { not: null } };
}

/** The eligibility rule for a document a patient may download (mirrors patient_documents_read's patient clause). */
export function eligibleDocumentWhere(ctx: PatientContext): Prisma.PatientDocumentWhereInput {
  return { clinicId: ctx.clinicId, patientId: { in: ctx.patientIds }, category: "LAB_REPORT", status: "AVAILABLE", labReport: eligibleReportWhere(ctx) };
}

const reportSelect = {
  id: true, branchId: true, orderedByDoctorId: true, testType: true, title: true, resultDate: true, reviewedAt: true, sharedWithPatientAt: true, values: true,
} as const;
type ReportRow = Prisma.LabReportGetPayload<{ select: typeof reportSelect }>;

const docSelect = { id: true, labReportId: true, title: true, originalFilename: true, mimeType: true, sizeBytes: true, uploadedAt: true } as const;
type DocRow = Prisma.PatientDocumentGetPayload<{ select: typeof docSelect }>;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Only the five known keys, as strings (the database validated them on write). */
function valuesOf(raw: unknown): LabValue[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return raw
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && typeof (v as { parameter?: unknown }).parameter === "string")
    .map((v) => {
      const flag = str(v.flag);
      return { parameter: v.parameter as string, value: str(v.value), unit: str(v.unit), range: str(v.range), flag: flag === "low" || flag === "high" || flag === "normal" || flag === "abnormal" ? flag : null };
    });
}

async function toReports(tx: TenantTx, rows: ReportRow[], fileCounts: Map<string, number>): Promise<PortalLabReport[]> {
  const names = await lookupNames(tx, { branches: rows.map((r) => r.branchId), doctors: rows.map((r) => r.orderedByDoctorId).filter((x): x is string => Boolean(x)) });
  return rows.map((r) => ({
    id: r.id,
    testType: r.testType,
    title: r.title,
    resultDate: dateOnly(r.resultDate),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    sharedAt: r.sharedWithPatientAt!.toISOString(),
    branchName: names.branch.get(r.branchId)?.name ?? null,
    orderedByName: r.orderedByDoctorId ? (names.doctor.get(r.orderedByDoctorId)?.name ?? null) : null,
    fileCount: fileCounts.get(r.id) ?? 0,
  }));
}

function toDocuments(rows: DocRow[], reportTitles: Map<string, string>): PortalDocument[] {
  return rows.map((d) => ({
    id: d.id,
    labReportId: d.labReportId!,
    labReportTitle: reportTitles.get(d.labReportId!) ?? null,
    title: d.title,
    filename: d.originalFilename,
    mimeType: d.mimeType as PortalDocument["mimeType"],
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt?.toISOString() ?? null,
  }));
}

async function countFiles(tx: TenantTx, ctx: PatientContext, reportIds: string[]): Promise<Map<string, number>> {
  if (reportIds.length === 0) return new Map();
  const groups = await tx.patientDocument.groupBy({ by: ["labReportId"], where: { ...eligibleDocumentWhere(ctx), labReportId: { in: reportIds } }, _count: { _all: true } });
  return new Map(groups.map((g) => [g.labReportId!, g._count._all]));
}

async function logEvent(tx: TenantTx, action: string, outcome: "SUCCESS" | "DENIED", targetId: string, reason: string | null) {
  await tx.$executeRaw`SELECT app.log_event(${action}, ${outcome}, 'lab_report', ${targetId}, ${reason}, NULL, NULL, ${JSON.stringify({ portal: true })}::jsonb)`;
}

export async function getPortalSummary(ctx: PatientContext, db?: TenantTx): Promise<PortalSummary> {
  return runPatientScoped(ctx, db, async (tx) => {
    const [patient, reportCount, documentCount, latest] = await Promise.all([
      tx.patient.findFirst({ where: { id: { in: ctx.patientIds }, clinicId: ctx.clinicId }, select: { name: true, patientNumber: true } }),
      tx.labReport.count({ where: eligibleReportWhere(ctx) }),
      tx.patientDocument.count({ where: eligibleDocumentWhere(ctx) }),
      tx.labReport.findMany({ where: eligibleReportWhere(ctx), orderBy: [{ sharedWithPatientAt: "desc" }, { id: "desc" }], take: 3, select: reportSelect }),
    ]);
    return {
      clinicName: ctx.clinicName,
      patient: patient ? { name: patient.name, patientNumber: patient.patientNumber } : null,
      reportCount,
      documentCount,
      latestReports: await toReports(tx, latest, await countFiles(tx, ctx, latest.map((r) => r.id))),
    };
  });
}

const pageSchema = z.object({ page: z.coerce.number().int().optional(), pageSize: z.coerce.number().int().optional() });

export async function listMyLabReports(ctx: PatientContext, raw: unknown, db?: TenantTx): Promise<{ items: PortalLabReport[]; total: number; page: number; pageSize: number }> {
  const input = pageSchema.parse(raw);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 50);
  return runPatientScoped(ctx, db, async (tx) => {
    const where = eligibleReportWhere(ctx);
    const [rows, total] = await Promise.all([
      tx.labReport.findMany({ where, orderBy: [{ sharedWithPatientAt: "desc" }, { id: "desc" }], skip, take, select: reportSelect }),
      tx.labReport.count({ where }),
    ]);
    return { items: await toReports(tx, rows, await countFiles(tx, ctx, rows.map((r) => r.id))), total, page, pageSize };
  });
}

/**
 * One report with its values and result files. The view is audited
 * (lab_report.viewed, metadata { portal: true } only); a refused id is audited as
 * lab_report.access_denied and answered with the same 404 as an unknown id.
 */
export async function getMyLabReport(ctx: PatientContext, id: string, db?: TenantTx): Promise<PortalLabReportDetail> {
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const result = await runPatientScoped(ctx, db, async (tx) => {
    const row = await tx.labReport.findFirst({ where: { ...eligibleReportWhere(ctx), id }, select: reportSelect });
    if (!row) {
      await logEvent(tx, "lab_report.access_denied", "DENIED", id, "not_found");
      return null;
    }
    const files = await tx.patientDocument.findMany({ where: { ...eligibleDocumentWhere(ctx), labReportId: id }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], select: docSelect });
    const [report] = await toReports(tx, [row], new Map([[id, files.length]]));
    await logEvent(tx, "lab_report.viewed", "SUCCESS", id, null);
    return { ...report, values: valuesOf(row.values), files: toDocuments(files, new Map([[id, row.title]])) };
  });
  if (!result) throw new AuthError("NOT_FOUND"); // committed the denial audit first
  return result;
}

export async function listMyDocuments(ctx: PatientContext, raw: unknown, db?: TenantTx): Promise<{ items: PortalDocument[]; total: number; page: number; pageSize: number }> {
  const input = pageSchema.parse(raw);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 60);
  return runPatientScoped(ctx, db, async (tx) => {
    const where = eligibleDocumentWhere(ctx);
    const [rows, total] = await Promise.all([
      tx.patientDocument.findMany({ where, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], skip, take, select: docSelect }),
      tx.patientDocument.count({ where }),
    ]);
    const reportIds = [...new Set(rows.map((r) => r.labReportId!).filter(Boolean))];
    const reports = reportIds.length ? await tx.labReport.findMany({ where: { ...eligibleReportWhere(ctx), id: { in: reportIds } }, select: { id: true, title: true } }) : [];
    return { items: toDocuments(rows, new Map(reports.map((r) => [r.id, r.title]))), total, page, pageSize };
  });
}
