"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FlaskConicalIcon, PencilIcon, PlusIcon } from "lucide-react";
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
import { useCreateLiveLabTest, useLiveLabTests, useUpdateLiveLabTest } from "@/hooks/use-clinic-admin";
import type { LabTestCategory, LiveLabTest } from "@/lib/live-types";

// The clinic's lab test master (clinic database): the tests a doctor can order
// from a consultation. Tests are never deleted — a test no longer offered is
// deactivated, which removes it from the doctors' list but keeps past orders.

export const LAB_TEST_CATEGORY_LABELS: Record<LabTestCategory, string> = {
  pathology: "Pathology",
  radiology: "Radiology",
  cardiology: "Cardiology",
  other: "Other",
};
const CATEGORIES = Object.keys(LAB_TEST_CATEGORY_LABELS) as LabTestCategory[];

export function LiveLabTests() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<LabTestCategory | "all">("all");
  const [editing, setEditing] = useState<LiveLabTest | "new" | null>(null);
  const query = useLiveLabTests();
  const update = useUpdateLiveLabTest();
  const canManage = Boolean(query.data?.canManage);

  const q = search.trim().toLowerCase();
  const rows = (query.data?.items ?? []).filter((t) => (!q || t.name.toLowerCase().includes(q)) && (category === "all" || t.category === category));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lab Tests"
        description="The tests doctors can order from a consultation, such as blood tests, X-rays and scans."
        actions={canManage && <Button onClick={() => setEditing("new")}><PlusIcon /> Add Lab Test</Button>}
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search lab tests..." className="sm:w-72" />
        <Select value={category} onValueChange={(v) => setCategory(v as LabTestCategory | "all")}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{LAB_TEST_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Lab tests" onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FlaskConicalIcon}
          title={q || category !== "all" ? "No lab tests match" : "No lab tests yet"}
          description={canManage && !q ? "Add the tests your clinic offers, such as CBC, X-Ray or Ultrasound." : undefined}
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {rows.map((t) => (
            <div key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4" data-testid="lab-test-row">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConicalIcon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className={t.status === "active" ? "truncate font-medium text-foreground" : "truncate font-medium text-muted-foreground line-through"}>{t.name}</p>
                  <p className="text-xs text-muted-foreground">{LAB_TEST_CATEGORY_LABELS[t.category]}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:shrink-0">
                <Badge variant="outline" className={t.status === "active" ? "border-success/30 text-success" : "border-muted text-muted-foreground"}>
                  {t.status === "active" ? "Active" : "Inactive"}
                </Badge>
                {canManage && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t)}><PencilIcon /> Edit</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate(
                          { id: t.id, patch: { status: t.status === "active" ? "inactive" : "active" } },
                          { onSuccess: (u) => toast.success(`${u.name} ${u.status === "active" ? "reactivated" : "deactivated"}.`) }
                        )
                      }
                    >
                      {t.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <LabTestDialog test={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LabTestDialog({ test, onClose }: { test: LiveLabTest | null; onClose: () => void }) {
  const create = useCreateLiveLabTest();
  const update = useUpdateLiveLabTest();
  const [name, setName] = useState(test?.name ?? "");
  const [category, setCategory] = useState<LabTestCategory>(test?.category ?? "pathology");
  const pending = create.isPending || update.isPending;

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter the test's name.");
      return;
    }
    if (test) {
      update.mutate({ id: test.id, patch: { name: trimmed, category } }, { onSuccess: () => { toast.success("Lab test updated."); onClose(); } });
    } else {
      create.mutate({ name: trimmed, category }, { onSuccess: (t) => { toast.success(`${t.name} added.`); onClose(); } });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{test ? "Edit lab test" : "Add lab test"}</DialogTitle>
          <DialogDescription>{test ? "Rename this test or change its category." : "Doctors will see it in the consultation's lab test list."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="lt-name">Test name</Label>
            <Input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thyroid Profile" maxLength={60} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as LabTestCategory)}>
              <SelectTrigger className="w-full" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{LAB_TEST_CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : test ? "Save changes" : "Add lab test"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
