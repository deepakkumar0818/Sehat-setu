"use client";

import { useState } from "react";
import { toast } from "sonner";
import { InfoIcon, PencilIcon, PlusIcon, StethoscopeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { useCreateLiveSpecialty, useLiveSpecialtyUsage, useUpdateLiveSpecialty } from "@/hooks/use-clinic-admin";
import type { LiveSpecialty } from "@/lib/live-types";

// Specialties this clinic can use: the catalogue shared by every clinic on
// Sehat Setu, plus the clinic's own (added here by its administrators, visible
// to this clinic only). A specialty counts as offered once a doctor or
// department uses it.

export function LiveSpecialties() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LiveSpecialty | "new" | null>(null);
  const query = useLiveSpecialtyUsage();
  const canManage = Boolean(query.data?.canManage);
  const q = search.trim().toLowerCase();
  const rows = (query.data?.items ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  const offered = rows.filter((s) => s.doctorCount > 0 || s.departmentCount > 0);
  const others = rows.filter((s) => s.doctorCount === 0 && s.departmentCount === 0);

  const editButton = (s: LiveSpecialty) =>
    canManage && s.custom ? (
      <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => setEditing(s)}><PencilIcon /> Edit</Button>
    ) : null;
  const title = (s: LiveSpecialty, muted = false) => (
    <div className="flex items-start justify-between gap-2">
      <p className={muted ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}>{s.name}</p>
      {s.custom && <Badge variant="secondary" className="shrink-0">Custom</Badge>}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Specialties"
        description="Which specialties this clinic offers, from your doctors and departments."
        actions={canManage && <Button onClick={() => setEditing("new")}><PlusIcon /> Add Specialty</Button>}
      />

      <div role="note" className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          A specialty counts as offered once a doctor or department uses it. Set a doctor&apos;s specialty when you invite them (Staff), or a department&apos;s in
          Departments. {canManage ? "Missing one? Add it with Add Specialty — it's visible to your clinic only." : "Your clinic administrator can add specialties."}
        </span>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search specialties..." className="sm:w-72" />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Specialties" onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={StethoscopeIcon} title="No specialties found" />
      ) : (
        <div className="space-y-6">
          <section aria-label="Offered">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Offered here ({offered.length})</p>
            {offered.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">None yet. Add doctors or departments to start offering specialties.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {offered.map((s) => (
                  <div key={s.id} className="rounded-xl border bg-card p-4">
                    {title(s)}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.doctorCount} doctor{s.doctorCount === 1 ? "" : "s"} · {s.departmentCount} department{s.departmentCount === 1 ? "" : "s"}
                    </p>
                    {s.description && <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>}
                    {editButton(s)}
                  </div>
                ))}
              </div>
            )}
          </section>
          {others.length > 0 && (
            <section aria-label="Not offered">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not offered yet ({others.length})</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((s) => (
                  <div key={s.id} className="rounded-xl border border-dashed bg-muted/20 p-4">
                    {title(s, true)}
                    {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
                    {editButton(s)}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {editing && <SpecialtyDialog specialty={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SpecialtyDialog({ specialty, onClose }: { specialty: LiveSpecialty | null; onClose: () => void }) {
  const create = useCreateLiveSpecialty();
  const update = useUpdateLiveSpecialty();
  const [name, setName] = useState(specialty?.name ?? "");
  const [description, setDescription] = useState(specialty?.description ?? "");
  const pending = create.isPending || update.isPending;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter the specialty's name.");
      return;
    }
    const input = { name: trimmed, description: description.trim() || null };
    if (specialty) {
      update.mutate({ id: specialty.id, patch: input }, { onSuccess: () => { toast.success("Specialty updated."); onClose(); } });
    } else {
      create.mutate(input, { onSuccess: (s) => { toast.success(`${s.name} added. You can now pick it for doctors and departments.`); onClose(); } });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{specialty ? "Edit specialty" : "Add specialty"}</DialogTitle>
          <DialogDescription>{specialty ? "Rename this specialty or change its description." : "Your clinic's own specialty. Only your clinic sees it."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="sp-name">Specialty name</Label>
            <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ENT" maxLength={80} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-desc">Description (optional)</Label>
            <Input id="sp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Ear, nose and throat care." maxLength={300} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : specialty ? "Save changes" : "Add specialty"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
