"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LayersIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { useCreateLiveDepartment, useLiveBranchList, useLiveDepartments, useLiveSpecialtyUsage, useSetLiveDepartmentStatus, useUpdateLiveDepartment } from "@/hooks/use-clinic-admin";
import type { LiveDepartment } from "@/lib/live-types";

// Departments of the clinic (clinic database): clinic-wide or at one branch,
// optionally tied to a specialty. Doctor counts come from active doctor profiles.

const CLINIC_WIDE = "clinic";
const NONE = "none";

export function LiveDepartments() {
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [editing, setEditing] = useState<LiveDepartment | "new" | null>(null);
  const query = useLiveDepartments();
  const branches = useLiveBranchList().data ?? [];
  const setStatus = useSetLiveDepartmentStatus();
  const canManage = Boolean(query.data?.canManage);

  const q = search.trim().toLowerCase();
  const rows = (query.data?.items ?? []).filter(
    (d) =>
      (!q || [d.name, d.description ?? "", d.specialtyName ?? ""].some((v) => v.toLowerCase().includes(q))) &&
      (branchFilter === "all" || (branchFilter === CLINIC_WIDE ? d.branchId === null : d.branchId === branchFilter))
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description="Clinical departments, clinic-wide or at a single branch."
        actions={canManage && <Button onClick={() => setEditing("new")}><PlusIcon /> Add Department</Button>}
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search departments..." className="sm:w-72" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Branch"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            <SelectItem value={CLINIC_WIDE}>Clinic-wide only</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Departments" onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={LayersIcon} title={q || branchFilter !== "all" ? "No departments match" : "No departments yet"} description={canManage && !q ? "Add departments such as General Medicine or Paediatrics." : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <div key={d.id} className="flex flex-col rounded-xl border bg-card p-4" data-testid="department-card">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-semibold text-foreground">{d.name}</p>
                <Badge variant="outline" className={d.status === "active" ? "border-success/30 text-success" : "border-muted text-muted-foreground"}>
                  {d.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{d.branchName ?? "Clinic-wide"}{d.specialtyName ? ` · ${d.specialtyName}` : ""}</p>
              {d.description && <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{d.doctorCount} doctor{d.doctorCount === 1 ? "" : "s"}</p>
              {canManage && (
                <div className="mt-auto flex gap-1 pt-2">
                  <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setEditing(d)}><PencilIcon /> Edit</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      setStatus.mutate(
                        { id: d.id, status: d.status === "active" ? "inactive" : "active" },
                        { onSuccess: (u) => toast.success(`${u.name} ${u.status === "active" ? "reactivated" : "deactivated"}.`) }
                      )
                    }
                  >
                    {d.status === "active" ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <DepartmentDialog department={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DepartmentDialog({ department, onClose }: { department: LiveDepartment | null; onClose: () => void }) {
  const branches = (useLiveBranchList().data ?? []).filter((b) => b.status === "active");
  const specialties = useLiveSpecialtyUsage().data?.items ?? [];
  const create = useCreateLiveDepartment();
  const update = useUpdateLiveDepartment();
  const [form, setForm] = useState({
    name: department?.name ?? "",
    description: department?.description ?? "",
    branchId: department ? (department.branchId ?? CLINIC_WIDE) : CLINIC_WIDE,
    specialtyId: department?.specialtyId ?? NONE,
  });
  const pending = create.isPending || update.isPending;

  function save() {
    if (!form.name.trim()) {
      toast.error("Enter the department's name.");
      return;
    }
    const specialtyId = form.specialtyId === NONE ? null : form.specialtyId;
    const description = form.description.trim() || null;
    if (department) {
      update.mutate({ id: department.id, patch: { name: form.name.trim(), description, specialtyId } }, { onSuccess: () => { toast.success("Department updated."); onClose(); } });
    } else {
      create.mutate(
        { name: form.name.trim(), description, specialtyId, branchId: form.branchId === CLINIC_WIDE ? null : form.branchId },
        { onSuccess: (d) => { toast.success(`${d.name} added.`); onClose(); } }
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{department ? "Edit department" : "Add department"}</DialogTitle>
          <DialogDescription>{department ? "Update this department." : "Create a department for the whole clinic or one branch."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Department name</Label>
            <Input id="d-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. General Medicine" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label>Where</Label>
            <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))} disabled={Boolean(department)}>
              <SelectTrigger className="w-full" aria-label="Where"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={CLINIC_WIDE}>Whole clinic</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Specialty (optional)</Label>
            <Select value={form.specialtyId} onValueChange={(v) => setForm((f) => ({ ...f, specialtyId: v }))}>
              <SelectTrigger className="w-full" aria-label="Specialty"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {specialties.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-desc">Description (optional)</Label>
            <Input id="d-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={300} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : department ? "Save changes" : "Add department"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
