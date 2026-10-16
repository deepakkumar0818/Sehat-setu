"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BuildingIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { useClinicProfile, useCreateLiveBranch, useLiveBranchList, useSetLiveBranchStatus, useUpdateLiveBranch } from "@/hooks/use-clinic-admin";
import type { Branch } from "@/types";

// Branches of the signed-in user's clinic (clinic database). Adding needs
// branch.create; editing and (de)activating need branch.update. The server and
// the database re-check both.

const EMPTY = { name: "", code: "", city: "", address: "", phone: "", email: "" };

export function LiveBranches() {
  const can = useClinicProfile().data?.can;
  const canCreate = Boolean(can?.createBranch);
  const canUpdate = Boolean(can?.updateBranch);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [confirm, setConfirm] = useState<Branch | null>(null);
  const query = useLiveBranchList();
  const setStatus = useSetLiveBranchStatus();

  const q = search.trim().toLowerCase();
  const branches = (query.data ?? []).filter((b) => !q || [b.name, b.city, b.address, b.code ?? ""].some((v) => v.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        description="Every physical location this clinic operates."
        actions={canCreate && <Button onClick={() => setEditing("new")}><PlusIcon /> Add Branch</Button>}
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search branches..." className="sm:w-72" />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Branches" onRetry={() => query.refetch()} />
      ) : branches.length === 0 ? (
        <EmptyState icon={BuildingIcon} title={q ? "No branches match your search" : "No branches yet"} description={q ? undefined : "Add your first location to start booking appointments."} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <div key={b.id} className="flex flex-col rounded-xl border bg-card p-4" data-testid="branch-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.code}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {b.isHeadOffice && <Badge variant="outline" className="border-primary/30 text-primary">Head Office</Badge>}
                  <Badge variant="outline" className={b.status === "active" ? "border-success/30 text-success" : "border-muted text-muted-foreground"}>
                    {b.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{b.address}, {b.city}</p>
              <p className="mt-1 text-sm text-muted-foreground">{b.phone}{b.email ? ` · ${b.email}` : ""}</p>
              {canUpdate && (
                <div className="mt-auto flex gap-1 pt-2">
                  <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setEditing(b)}><PencilIcon /> Edit</Button>
                  {!b.isHeadOffice && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => (b.status === "active" ? setConfirm(b) : setStatus.mutate({ id: b.id, status: "active" }, { onSuccess: () => toast.success(`${b.name} reactivated.`) }))}
                    >
                      {b.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <BranchDialog branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Deactivate ${confirm?.name}?`}
        description="It will no longer be offered for new appointments or bills. Existing records stay. You can reactivate it later."
        confirmLabel="Deactivate"
        destructive
        isLoading={setStatus.isPending}
        onConfirm={() => {
          if (!confirm) return;
          const name = confirm.name;
          setStatus.mutate({ id: confirm.id, status: "inactive" }, { onSuccess: () => toast.success(`${name} deactivated.`), onSettled: () => setConfirm(null) });
        }}
      />
    </div>
  );
}

function BranchDialog({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const create = useCreateLiveBranch();
  const update = useUpdateLiveBranch();
  const [form, setForm] = useState(
    branch ? { name: branch.name, code: branch.code ?? "", city: branch.city, address: branch.address, phone: branch.phone, email: branch.email ?? "" } : EMPTY
  );
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pending = create.isPending || update.isPending;
  const valid = form.name.trim() && form.city.trim() && form.address.trim() && form.phone.trim();

  function save() {
    if (!valid) {
      toast.error("Fill in the name, city, address and phone.");
      return;
    }
    const fields = { name: form.name.trim(), city: form.city.trim(), address: form.address.trim(), phone: form.phone.trim(), email: form.email.trim() };
    if (branch) {
      update.mutate({ id: branch.id, patch: fields }, { onSuccess: () => { toast.success("Branch updated."); onClose(); } });
    } else {
      create.mutate({ ...fields, code: form.code.trim() || undefined }, { onSuccess: (b) => { toast.success(`${b.name} added (code ${b.code}).`); onClose(); } });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{branch ? "Edit branch" : "Add branch"}</DialogTitle>
          <DialogDescription>{branch ? "Update this location's details." : "Add a new location for this clinic."}</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="b-name">Branch name</Label>
            <Input id="b-name" value={form.name} onChange={set("name")} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-code">Branch code</Label>
            <Input id="b-code" value={form.code} onChange={set("code")} disabled={Boolean(branch)} placeholder={branch ? undefined : "Auto"} maxLength={16} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-city">City</Label>
            <Input id="b-city" value={form.city} onChange={set("city")} maxLength={80} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="b-address">Address</Label>
            <Input id="b-address" value={form.address} onChange={set("address")} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-phone">Phone</Label>
            <Input id="b-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-email">Email (optional)</Label>
            <Input id="b-email" type="email" value={form.email} onChange={set("email")} />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : branch ? "Save changes" : "Add branch"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
