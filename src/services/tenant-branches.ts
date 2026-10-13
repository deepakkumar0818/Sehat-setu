// Branch CRUD scoped to a clinic tenant — for internal clinic-admin screens
// (src/hooks/use-branches.ts's simple `useBranches()` remains for existing
// read-only branch selectors elsewhere in the app).
import { delay, matchesSearch } from "@/lib/async";
import { padId } from "@/lib/rng";
import { getDb, mutateDb } from "@/store/data-store";
import { logAudit } from "@/services/audit";
import type { AuthUser, Branch } from "@/types";

export async function listBranchesForClinic(clinicId: string, search = ""): Promise<Branch[]> {
  await delay(250);
  return getDb().branches.filter((b) => b.clinicId === clinicId && matchesSearch([b.name, b.city, b.address], search));
}

export interface CreateBranchInput {
  clinicId: string;
  name: string;
  code?: string;
  city: string;
  address: string;
  phone: string;
  email?: string;
  workingHours?: string;
  timezone?: string;
  actor: Pick<AuthUser, "name" | "role">;
}

export async function createBranch(input: CreateBranchInput): Promise<Branch> {
  await delay(400);
  const db = getDb();
  const branch: Branch = {
    id: padId("BR", db.branches.length + 1, 3),
    clinicId: input.clinicId,
    name: input.name,
    code: input.code,
    city: input.city,
    address: input.address,
    phone: input.phone,
    email: input.email,
    workingHours: input.workingHours,
    timezone: input.timezone ?? "Asia/Kolkata",
    isHeadOffice: !db.branches.some((b) => b.clinicId === input.clinicId),
    status: "active",
  };
  mutateDb((d) => ({ ...d, branches: [...d.branches, branch] }));
  logAudit({ actor: input.actor, action: "Created branch", entityType: "branch", entityId: branch.id, branchId: branch.id });
  return branch;
}

export async function updateBranchStatus(id: string, status: Branch["status"], actor: Pick<AuthUser, "name" | "role">): Promise<void> {
  await delay(300);
  mutateDb((d) => ({ ...d, branches: d.branches.map((b) => (b.id === id ? { ...b, status } : b)) }));
  logAudit({ actor, action: status === "active" ? "Reactivated branch" : "Deactivated branch", entityType: "branch", entityId: id, branchId: id });
}
