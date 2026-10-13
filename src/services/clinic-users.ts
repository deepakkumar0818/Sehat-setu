// Unified read model over doctors + staff for the /clinic/users management
// table. Creation still goes through the existing services/people.ts
// createDoctor/createStaff (each already wired to the real email/SMS
// new-account notification flow) — this file only merges the two for display.
import { delay, matchesSearch, paginate, type PagedResult } from "@/lib/async";
import { getDb } from "@/store/data-store";
import type { Doctor, StaffMember, UserRole } from "@/types";

export interface ClinicUserRow {
  id: string;
  kind: "doctor" | "staff";
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  branchId: string;
  branchName: string;
  departmentId?: string;
  departmentName?: string;
  specialtyName?: string;
  status: string;
  lastActiveAt?: string;
  joinedDate: string;
  avatarColor: string;
}

export interface ListClinicUsersParams {
  clinicId: string;
  search?: string;
  role?: UserRole | "all";
  branchId?: string | "all";
  departmentId?: string | "all";
  status?: string | "all";
  page?: number;
  pageSize?: number;
}

function doctorToRow(d: Doctor, branchName: string, departmentName?: string): ClinicUserRow {
  return {
    id: d.id, kind: "doctor", name: d.name, email: d.email, phone: d.phone, role: "doctor",
    branchId: d.branchId, branchName, departmentId: d.departmentId, departmentName,
    specialtyName: d.specialization, status: d.status, joinedDate: d.joinedDate, avatarColor: d.avatarColor,
  };
}

function staffToRow(s: StaffMember, branchName: string, departmentName?: string): ClinicUserRow {
  return {
    id: s.id, kind: "staff", name: s.name, email: s.email, phone: s.phone, role: s.role,
    branchId: s.branchId, branchName, departmentId: s.departmentId, departmentName,
    status: s.status, lastActiveAt: s.lastActiveAt, joinedDate: s.joinedDate, avatarColor: s.avatarColor,
  };
}

export async function listClinicUsers(params: ListClinicUsersParams): Promise<PagedResult<ClinicUserRow>> {
  await delay();
  const db = getDb();
  const { clinicId, search = "", role = "all", branchId = "all", departmentId = "all", status = "all", page = 1, pageSize = 15 } = params;
  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const deptName = (id?: string) => (id ? db.departments.find((d) => d.id === id)?.name : undefined);

  const doctorRows = db.doctors.filter((d) => d.clinicId === clinicId).map((d) => doctorToRow(d, branchName(d.branchId), deptName(d.departmentId)));
  const staffRows = db.staff.filter((s) => s.clinicId === clinicId).map((s) => staffToRow(s, branchName(s.branchId), deptName(s.departmentId)));

  let rows = [...doctorRows, ...staffRows];
  rows = rows.filter((r) => {
    if (role !== "all" && r.role !== role) return false;
    if (branchId !== "all" && r.branchId !== branchId) return false;
    if (departmentId !== "all" && r.departmentId !== departmentId) return false;
    if (status !== "all" && r.status !== status) return false;
    return matchesSearch([r.name, r.email, r.phone], search);
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  return paginate(rows, page, pageSize);
}
