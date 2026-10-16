"use client";

import { useLiveData } from "@/lib/data-source";
import { LiveBranches } from "@/components/clinic-admin/live-branches";
import { useState } from "react";
import { toast } from "sonner";
import { BuildingIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { useBranchesForClinic, useCreateBranch, useUpdateBranchStatus } from "@/hooks/use-tenant-branches";
import { useCurrentClinicId } from "@/hooks/use-current-clinic-id";
import { useCurrentUser } from "@/hooks/use-current-user";

function DemoClinicBranchesPage() {
  const clinicId = useCurrentClinicId();
  const user = useCurrentUser();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: branches = [], isLoading } = useBranchesForClinic(clinicId, search);
  const createBranch = useCreateBranch();
  const updateStatus = useUpdateBranchStatus();

  const [form, setForm] = useState({ name: "", code: "", city: "", address: "", phone: "", email: "", workingHours: "9:00 AM - 6:00 PM", timezone: "Asia/Kolkata" });

  function handleCreate() {
    if (!clinicId || !user) return;
    if (!form.name || !form.city || !form.address || !form.phone) {
      toast.error("Fill in name, city, address, and phone.");
      return;
    }
    createBranch.mutate(
      { clinicId, ...form, actor: { name: user.name, role: user.role } },
      {
        onSuccess: () => {
          toast.success("Branch created.");
          setOpen(false);
          setForm({ name: "", code: "", city: "", address: "", phone: "", email: "", workingHours: "9:00 AM - 6:00 PM", timezone: "Asia/Kolkata" });
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        description="Every physical location this clinic operates."
        actions={<Button onClick={() => setOpen(true)}><PlusIcon /> Add Branch</Button>}
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search branches..." className="sm:w-72" />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : branches.length === 0 ? (
        <EmptyState icon={BuildingIcon} title="No branches found" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <div key={b.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-foreground">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.code ?? b.id}</p>
                </div>
                <div className="flex gap-1.5">
                  {b.isHeadOffice && <Badge variant="outline" className="border-primary/30 text-primary">Head Office</Badge>}
                  <Badge variant="outline" className={b.status === "active" ? "border-success/30 text-success" : "border-muted text-muted-foreground"}>{b.status}</Badge>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{b.address}, {b.city}</p>
              <p className="mt-1 text-sm text-muted-foreground">{b.phone}</p>
              {b.workingHours && <p className="mt-1 text-xs text-muted-foreground">{b.workingHours}</p>}
              {!b.isHeadOffice && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 -ml-2"
                  onClick={() => {
                    if (!user) return;
                    updateStatus.mutate({ id: b.id, status: b.status === "active" ? "inactive" : "active", actor: { name: user.name, role: user.role } });
                  }}
                >
                  {b.status === "active" ? "Deactivate" : "Reactivate"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add branch</DialogTitle>
            <DialogDescription>Add a new location for this clinic.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="b-name">Branch name</Label>
              <Input id="b-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-code">Branch code</Label>
              <Input id="b-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-city">City</Label>
              <Input id="b-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="b-address">Address</Label>
              <Input id="b-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-phone">Phone</Label>
              <Input id="b-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-email">Email</Label>
              <Input id="b-email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-hours">Working hours</Label>
              <Input id="b-hours" value={form.workingHours} onChange={(e) => setForm((f) => ({ ...f, workingHours: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-tz">Timezone</Label>
              <Input id="b-tz" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createBranch.isPending}>{createBranch.isPending ? "Saving…" : "Add branch"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Live staff app: the clinic database. Demo mode keeps the in-browser sample data.
export default function ClinicBranchesPage() {
  return useLiveData() ? <LiveBranches /> : <DemoClinicBranchesPage />;
}
