"use client";

import { useLiveData } from "@/lib/data-source";
import { LiveDepartments } from "@/components/clinic-admin/live-departments";
import { useState } from "react";
import { toast } from "sonner";
import { LayersIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { useCreateDepartment, useDepartments } from "@/hooks/use-departments";
import { useSpecialtiesForClinic } from "@/hooks/use-specialties";
import { useBranchesForClinic } from "@/hooks/use-tenant-branches";
import { useCurrentClinicId } from "@/hooks/use-current-clinic-id";
import { useCurrentUser } from "@/hooks/use-current-user";

function DemoClinicDepartmentsPage() {
  const clinicId = useCurrentClinicId();
  const user = useCurrentUser();
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string | "all">("all");
  const [open, setOpen] = useState(false);

  const { data: branches = [] } = useBranchesForClinic(clinicId);
  const { data: specialties = [] } = useSpecialtiesForClinic(clinicId);
  const { data: departments = [], isLoading } = useDepartments({ clinicId: clinicId ?? "", branchId: branchFilter, search });
  const createDepartment = useCreateDepartment();

  const [form, setForm] = useState({ name: "", branchId: "", specialtyId: "", description: "" });

  function handleCreate() {
    if (!clinicId || !user || !form.name || !form.branchId) {
      toast.error("Name and branch are required.");
      return;
    }
    createDepartment.mutate(
      {
        clinicId,
        branchId: form.branchId,
        name: form.name,
        specialtyId: form.specialtyId || undefined,
        description: form.description || undefined,
        actor: { name: user.name, role: user.role },
      },
      {
        onSuccess: () => {
          toast.success("Department created.");
          setOpen(false);
          setForm({ name: "", branchId: "", specialtyId: "", description: "" });
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Departments"
        description="Clinical departments across your branches, each headed by a doctor."
        actions={<Button onClick={() => setOpen(true)}><PlusIcon /> Add Department</Button>}
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search departments..." className="sm:w-72" />
        <Select value={branchFilter} onValueChange={(v) => setBranchFilter(v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : departments.length === 0 ? (
        <EmptyState icon={LayersIcon} title="No departments found" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <div key={d.id} className="rounded-xl border bg-card p-4">
              <p className="font-semibold text-foreground">{d.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{branches.find((b) => b.id === d.branchId)?.name}</p>
              {d.headName && <p className="mt-2 text-sm text-muted-foreground">Head: <span className="text-foreground">{d.headName}</span></p>}
              <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                <span>{d.doctorCount} doctor{d.doctorCount === 1 ? "" : "s"}</span>
                <span>{d.nurseCount} nurse{d.nurseCount === 1 ? "" : "s"}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add department</DialogTitle>
            <DialogDescription>Create a department within a branch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Department name</Label>
              <Input id="d-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Cardiology Department" />
            </div>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Specialty (optional)</Label>
              <Select value={form.specialtyId} onValueChange={(v) => setForm((f) => ({ ...f, specialtyId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select specialty" /></SelectTrigger>
                <SelectContent>
                  {specialties.filter((s) => s.enabled).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-desc">Description (optional)</Label>
              <Input id="d-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createDepartment.isPending}>{createDepartment.isPending ? "Saving…" : "Add department"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Live staff app: the clinic database. Demo mode keeps the in-browser sample data.
export default function ClinicDepartmentsPage() {
  return useLiveData() ? <LiveDepartments /> : <DemoClinicDepartmentsPage />;
}
