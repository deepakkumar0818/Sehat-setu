import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/server/auth/errors";
import { assertBranchAccess, hasAnyPermission, requirePermission, type TenantContext } from "@/server/auth/authorize";
import type { TenantTx } from "@/server/db/tenant";
import type { LabValue, LabReportStatusKey } from "@/lib/documents";
import type { LabReportPage, LiveLabReport, LiveLabReportDetail } from "@/lib/live-types";
import {
  CLINICAL_READ,
  LAB_REPORT_CREATE,
  LAB_REPORT_REVIEW,
  LAB_REPORT_SHARE,
  LAB_VALUES_UPDATE,
  createLabReportSchema,
  dbCall,
  listLabReportsSchema,
  setLabValuesSchema,
  uuid,
} from "./document-rules";
import { lookupNames, toDocumentDtos } from "./documents";
import { pageArgs, runScoped } from "./scope";

// Lab reports (migration 20261021000000_patient_documents).
//
// Lifecycle: PENDING (ordered/registered, no result yet) → AVAILABLE (a result
// file arrived or values were entered) → REVIEWED (the assigned doctor signed
// it). Changing values clears the review; a report shared with the patient is
// locked until it is unshared. Reads are RLS-filtered (clinical readers only);
// every write is an app.* function that re-checks the caller. Lab report
// numbering is deliberately not implemented (deferred).

const reportSelect = {
  id: true, clinicId: true, branchId: true, patientId: true, consultationId: true, orderedByDoctorId: true, testType: true, title: true,
  status: true, resultDate: true, values: true, notes: true, reviewedByUserId: true, reviewedAt: true, sharedWithPatientAt: true,
  createdAt: true, updatedAt: true,
} as const;
type ReportRow = Prisma.LabReportGetPayload<{ select: typeof reportSelect }>;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function valuesOf(raw: unknown): LabValue[] {
  return Array.isArray(raw) ? (raw.filter((v) => v && typeof v === "object" && typeof (v as LabValue).parameter === "string") as LabValue[]) : [];
}

async function toDtos(tx: TenantTx, rows: ReportRow[]): Promise<LiveLabReport[]> {
  const names = await lookupNames(tx, {
    patients: rows.map((r) => r.patientId),
    branches: rows.map((r) => r.branchId),
    users: rows.map((r) => r.reviewedByUserId).filter((x): x is string => Boolean(x)),
    doctors: rows.map((r) => r.orderedByDoctorId).filter((x): x is string => Boolean(x)),
  });
  return rows.map((r) => {
    const patient = names.patient.get(r.patientId);
    return {
      id: r.id,
      patientId: r.patientId,
      patientName: patient?.name ?? null,
      patientNumber: patient?.patientNumber ?? null,
      branch: names.branch.get(r.branchId) ?? null,
      testType: r.testType,
      title: r.title,
      status: r.status as LabReportStatusKey,
      resultDate: dateOnly(r.resultDate),
      orderedBy: r.orderedByDoctorId ? (names.doctor.get(r.orderedByDoctorId) ?? null) : null,
      consultationId: r.consultationId,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedByName: r.reviewedByUserId ? (names.user.get(r.reviewedByUserId) ?? null) : null,
      sharedWithPatientAt: r.sharedWithPatientAt?.toISOString() ?? null,
      valueCount: valuesOf(r.values).length,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** UI hints only — every action is decided again by the database function. */
function actionsFor(ctx: TenantContext, r: ReportRow) {
  const shared = r.sharedWithPatientAt !== null;
  const maySign = Boolean(ctx.doctorId) && hasAnyPermission(ctx, LAB_REPORT_REVIEW) && (r.orderedByDoctorId === null || r.orderedByDoctorId === ctx.doctorId);
  return {
    canEditValues: hasAnyPermission(ctx, LAB_VALUES_UPDATE) && !shared,
    canReview: maySign && r.status === "AVAILABLE",
    canShare: r.status === "REVIEWED" && (hasAnyPermission(ctx, ["lab.manage", "medical_record.manage"]) || maySign),
    canAttach: hasAnyPermission(ctx, LAB_REPORT_CREATE),
  };
}

export async function listLabReports(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<LabReportPage> {
  requirePermission(ctx, [...CLINICAL_READ, ...LAB_REPORT_CREATE]);
  const input = listLabReportsSchema.parse(raw);
  const { page, pageSize, skip, take } = pageArgs(input.page, input.pageSize, 50);
  const canView = hasAnyPermission(ctx, CLINICAL_READ);
  const canCreate = hasAnyPermission(ctx, LAB_REPORT_CREATE);
  if (!canView) return { items: [], total: 0, page, pageSize, canCreate, canView }; // upload-only: never reads reports back
  const search = input.search ? { contains: input.search, mode: "insensitive" as const } : undefined;
  const where: Prisma.LabReportWhereInput = {
    clinicId: ctx.clinicId,
    ...(input.status !== "all" ? { status: input.status } : {}),
    ...(input.patientId ? { patientId: input.patientId } : {}),
    ...(search ? { OR: [{ title: search }, { testType: search }, { patient: { name: search } }, { patient: { patientNumber: search } }] } : {}),
  };
  return runScoped(ctx, db, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.labReport.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take, select: reportSelect }),
      tx.labReport.count({ where }),
    ]);
    return { items: await toDtos(tx, rows), total, page, pageSize, canCreate, canView };
  });
}

async function loadDetail(ctx: TenantContext, tx: TenantTx, id: string): Promise<LiveLabReportDetail> {
  const row = await tx.labReport.findFirst({ where: { id, clinicId: ctx.clinicId }, select: reportSelect });
  if (!row) throw new AuthError("NOT_FOUND");
  const docs = await tx.patientDocument.findMany({
    where: { clinicId: ctx.clinicId, labReportId: id, status: { in: ["AVAILABLE", "ARCHIVED"] } },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, clinicId: true, branchId: true, patientId: true, labReportId: true, consultationId: true, category: true, title: true,
      originalFilename: true, mimeType: true, sizeBytes: true, status: true, uploadedByUserId: true, uploadedAt: true, archivedAt: true, archiveReason: true,
    },
  });
  const [dto] = await toDtos(tx, [row]);
  return { ...dto, values: valuesOf(row.values), notes: row.notes, attachments: await toDocumentDtos(ctx, tx, docs), actions: actionsFor(ctx, row) };
}

export async function getLabReport(ctx: TenantContext, id: string, db?: TenantTx): Promise<LiveLabReportDetail> {
  requirePermission(ctx, CLINICAL_READ);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, (tx) => loadDetail(ctx, tx, id));
}

/** Registers a lab report (e.g. for a test ordered in a consultation). Upload-only callers get the id back but can't read it. */
export async function createLabReport(ctx: TenantContext, raw: unknown, db?: TenantTx): Promise<{ id: string; readable: boolean }> {
  requirePermission(ctx, LAB_REPORT_CREATE);
  const input = createLabReportSchema.parse(raw);
  if (input.branchId) assertBranchAccess(ctx, input.branchId);
  return runScoped(ctx, db, async (tx) => {
    const [{ id }] = await dbCall(() => tx.$queryRaw<{ id: string }[]>`
      SELECT app.create_lab_report(${input.patientId}::uuid, ${input.testType}, ${input.title}, ${input.consultationId ?? null}::uuid, ${input.branchId ?? null}::uuid)::text AS id`);
    const readable = Boolean(await tx.labReport.findFirst({ where: { id, clinicId: ctx.clinicId }, select: { id: true } }));
    return { id, readable };
  });
}

/** Empty optional cells are dropped so the stored JSON stays minimal. */
function cleanValues(values: LabValue[]): LabValue[] {
  return values.map((v) => {
    const out: LabValue = { parameter: v.parameter.trim() };
    for (const k of ["value", "unit", "range"] as const) {
      const s = v[k]?.trim();
      if (s) out[k] = s;
    }
    if (v.flag) out.flag = v.flag;
    return out;
  });
}

export async function setLabReportValues(ctx: TenantContext, id: string, raw: unknown, db?: TenantTx): Promise<LiveLabReportDetail> {
  requirePermission(ctx, LAB_VALUES_UPDATE);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  const input = setLabValuesSchema.parse(raw);
  const values = JSON.stringify(cleanValues(input.values));
  return runScoped(ctx, db, async (tx) => {
    await dbCall(() => tx.$executeRaw`SELECT app.set_lab_report_values(${id}::uuid, ${values}::jsonb, ${input.resultDate ?? null}::date, ${input.notes ?? null})`);
    return loadDetail(ctx, tx, id);
  });
}

export async function reviewLabReport(ctx: TenantContext, id: string, db?: TenantTx): Promise<LiveLabReportDetail> {
  requirePermission(ctx, LAB_REPORT_REVIEW);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await dbCall(() => tx.$executeRaw`SELECT app.review_lab_report(${id}::uuid)`);
    return loadDetail(ctx, tx, id);
  });
}

export async function setLabReportShared(ctx: TenantContext, id: string, shared: boolean, db?: TenantTx): Promise<LiveLabReportDetail> {
  requirePermission(ctx, LAB_REPORT_SHARE);
  if (!uuid.safeParse(id).success) throw new AuthError("NOT_FOUND");
  return runScoped(ctx, db, async (tx) => {
    await dbCall(() => tx.$executeRaw`SELECT app.set_lab_report_shared(${id}::uuid, ${shared})`);
    return loadDetail(ctx, tx, id);
  });
}
