"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon, StethoscopeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { useCurrentClinicId } from "@/hooks/use-current-clinic-id";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCreateSpecialty, useSetClinicSpecialtyEnabled, useSpecialtiesForClinic } from "@/hooks/use-specialties";

export default function ClinicSpecialtiesPage() {
  const clinicId = useCurrentClinicId();
  const user = useCurrentUser();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", services: "" });

  const { data: rows = [], isLoading } = useSpecialtiesForClinic(clinicId);
  const setEnabled = useSetClinicSpecialtyEnabled();
  const createSpecialty = useCreateSpecialty();

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
  const enabled = filtered.filter((r) => r.enabled);
  const available = filtered.filter((r) => !r.enabled);

  function handleCreate() {
    if (!clinicId || !user || !form.name.trim()) return;
    createSpecialty.mutate(
      {
        clinicId,
        name: form.name.trim(),
        description: form.description.trim() || `${form.name.trim()} services at this clinic.`,
        services: form.services.split(",").map((s) => s.trim()).filter(Boolean),
        actor: { name: user.name, role: user.role },
      },
      {
        onSuccess: () => {
          toast.success("Specialty added.");
          setOpen(false);
          setForm({ name: "", description: "", services: "" });
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Specialties"
        description="Which specialties this clinic offers, and how many doctors provide each."
        actions={<Button onClick={() => setOpen(true)}><PlusIcon /> Add Specialty</Button>}
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search specialties..." className="sm:w-72" />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={StethoscopeIcon} title="No specialties found" />
      ) : (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enabled ({enabled.length})</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {enabled.map((s) => (
                <div key={s.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{s.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.doctorCount} doctor{s.doctorCount === 1 ? "" : "s"}</p>
                    </div>
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(v) => clinicId && user && setEnabled.mutate({ clinicId, specialtyId: s.id, enabled: v, actor: { name: user.name, role: user.role } })}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
                  {s.services.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.services.slice(0, 4).map((svc) => <span key={svc} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-primary">{svc}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {available.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available to enable ({available.length})</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {available.map((s) => (
                  <div key={s.id} className="rounded-xl border border-dashed bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-muted-foreground">{s.name}</p>
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => clinicId && user && setEnabled.mutate({ clinicId, specialtyId: s.id, enabled: v, actor: { name: user.name, role: user.role } })}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{s.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a custom specialty</DialogTitle>
            <DialogDescription>Not in the catalog? Add your own.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-desc">Description</Label>
              <Textarea id="sp-desc" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-services">Services (comma-separated)</Label>
              <Input id="sp-services" value={form.services} onChange={(e) => setForm((f) => ({ ...f, services: e.target.value }))} placeholder="e.g. Consultation, Follow-up" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createSpecialty.isPending}>{createSpecialty.isPending ? "Saving…" : "Add specialty"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
