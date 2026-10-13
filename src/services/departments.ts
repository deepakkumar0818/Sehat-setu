import { delay, matchesSearch } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { logAudit } from "@/services/audit";
import type { AuthUser, Department } from "@/types";

export interface DepartmentWithStats extends Department {
  doctorCount: number;
  nurseCount: number;
  headName?: string;
}

export interface ListDepartmentsParams {
  clinicId: string;
  branchId?: string | "all";
  search?: string;
}

export async function listDepartments(params: ListDepartmentsParams): Promise<DepartmentWithStats[]> {
  await delay(250);
  const db = getDb();
  const { clinicId, branchId = "all", search = "" } = params;
  return db.departments
    .filter((dept) => dept.clinicId === clinicId)
    .filter((dept) => branchId === "all" || dept.branchId === branchId)
    .filter((dept) => matchesSearch([dept.name, dept.description ?? ""], search))
    .map((dept) => {
      const head = [...db.doctors, ...db.staff].find((p) => p.id === dept.headUserId);
      return {
        ...dept,
        doctorCount: db.doctors.filter((d) => d.departmentId === dept.id && d.status === "active").length,
        nurseCount: db.staff.filter((s) => s.departmentId === dept.id && s.role === "nurse" && s.status === "active").length,
        headName: head?.name,
      };
    });
}

export async function getDepartment(id: string): Promise<Department | undefined> {
  await delay(200);
  return getDb().departments.find((d) => d.id === id);
}

export interface CreateDepartmentInput {
  clinicId: string;
  branchId: string;
  name: string;
  specialtyId?: string;
  description?: string;
  headUserId?: string;
  actor: Pick<AuthUser, "name" | "role">;
}

export async function createDepartment(input: CreateDepartmentInput): Promise<Department> {
  await delay(400);
  const db = getDb();
  const department: Department = {
    id: padId("DEPT", db.departments.length + 1, 4),
    clinicId: input.clinicId,
    branchId: input.branchId,
    name: input.name,
    specialtyId: input.specialtyId,
    description: input.description,
    headUserId: input.headUserId,
    status: "active",
  };
  mutateDb((d) => ({ ...d, departments: [...d.departments, department] }));
  logAudit({ actor: input.actor, action: "Created department", entityType: "department", entityId: department.id, branchId: input.branchId });
  return department;
}

export async function updateDepartment(id: string, patch: Partial<Pick<Department, "name" | "description" | "headUserId" | "specialtyId" | "status">>): Promise<Department> {
  await delay(350);
  let updated: Department | undefined;
  mutateDb((d) => ({
    ...d,
    departments: d.departments.map((dept) => {
      if (dept.id !== id) return dept;
      updated = { ...dept, ...patch };
      return updated;
    }),
  }));
  if (!updated) throw new Error("Department not found");
  return updated;
}

/** Doctors and nurses eligible to be assigned to a department (same clinic + branch). */
export async function listAssignableStaffForDepartment(clinicId: string, branchId: string) {
  await delay(200);
  const db = getDb();
  const doctors = db.doctors.filter((d) => d.clinicId === clinicId && d.branchId === branchId && d.status === "active");
  const nurses = db.staff.filter((s) => s.clinicId === clinicId && s.branchId === branchId && s.role === "nurse" && s.status === "active");
  return { doctors, nurses };
}
