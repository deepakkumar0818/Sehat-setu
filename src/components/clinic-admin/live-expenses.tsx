"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlusIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { useBillingSummary } from "@/hooks/use-billing";
import { useCreateLiveExpense, useLiveBranchList, useLiveExpenses, useVoidLiveExpense } from "@/hooks/use-clinic-admin";
import { useTodayKey } from "@/lib/data-source";
import { formatCurrency, formatDate } from "@/lib/format";
import type { LiveExpense, LiveExpenseCategory } from "@/lib/live-types";

// Clinic expenses (clinic database). Recorded per branch; never edited or
// deleted — a wrong entry is voided with a reason and drops out of the totals.

export const EXPENSE_CATEGORY_LABELS: Record<LiveExpenseCategory, string> = {
  rent: "Rent",
  salary: "Salary",
  utilities: "Utilities",
  equipment: "Equipment",
  medicine_purchase: "Medicine purchase",
  lab_expense: "Lab expense",
  marketing: "Marketing",
  maintenance: "Maintenance",
  other: "Other",
};
const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as LiveExpenseCategory[];

export function LiveExpenses() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<LiveExpenseCategory | "all">("all");
  const [status, setStatus] = useState<"recorded" | "voided" | "all">("recorded");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<LiveExpense | null>(null);

  const query = useLiveExpenses({ search: search.trim() || undefined, category: category === "all" ? undefined : category, status, page, pageSize: 10 });
  const summary = useBillingSummary();
  const data = query.data;
  const canManage = Boolean(data?.canManage);
  const revenue = summary.data?.totalRevenueThisMonth;
  const spent = data?.monthTotal;
  const net = revenue !== undefined && spent !== undefined ? revenue - spent : undefined;

  const columns: DataTableColumn<LiveExpense>[] = [
    { key: "date", header: "Date", render: (e) => formatDate(e.date) },
    {
      key: "description",
      header: "Description",
      render: (e) => (
        <div className="min-w-0">
          <p className={e.status === "voided" ? "text-muted-foreground line-through" : "text-foreground"}>{e.description}</p>
          <p className="text-xs text-muted-foreground">
            {e.branchName} · by {e.recordedBy}
            {e.reference ? ` · ref ${e.reference}` : ""}
            {e.status === "voided" && e.voidReason ? ` · voided: ${e.voidReason}` : ""}
          </p>
        </div>
      ),
    },
    { key: "category", header: "Category", render: (e) => <Badge variant="outline">{EXPENSE_CATEGORY_LABELS[e.category]}</Badge> },
    { key: "paidTo", header: "Paid To", render: (e) => e.paidTo ?? "—" },
    { key: "amount", header: "Amount", render: (e) => <span className={e.status === "voided" ? "text-muted-foreground line-through" : undefined}>{formatCurrency(e.amount)}</span> },
    {
      key: "actions",
      header: "",
      render: (e) =>
        canManage && e.status === "recorded" ? (
          <Button variant="ghost" size="sm" onClick={() => setVoiding(e)}>Void</Button>
        ) : e.status === "voided" ? (
          <Badge variant="outline" className="border-muted text-muted-foreground">Voided</Badge>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description="Track clinic expenses across categories and branches."
        actions={canManage && <Button onClick={() => setAdding(true)}><PlusIcon /> Add Expense</Button>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Revenue this Month" value={revenue !== undefined ? formatCurrency(revenue) : "—"} isLoading={summary.isLoading} />
        <StatCard label="Expenses this Month" value={spent !== undefined ? formatCurrency(spent) : "—"} isLoading={query.isLoading} />
        <StatCard label="Net Income" value={net !== undefined ? formatCurrency(net) : "—"} tone={net !== undefined && net < 0 ? "danger" : "default"} isLoading={summary.isLoading || query.isLoading} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search description, payee or reference..." />
        <div className="flex gap-2">
          <Select value={category} onValueChange={(v) => { setCategory(v as LiveExpenseCategory | "all"); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recorded">Recorded</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.error ? (
        <QueryError error={query.error} what="Expenses" onRetry={() => query.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(e) => e.id}
            isLoading={query.isLoading}
            className="rounded-none border-0"
            emptyState={
              <EmptyState
                icon={WalletIcon}
                title={search || category !== "all" || status !== "recorded" ? "No expenses match" : "No expenses recorded yet"}
                description={canManage ? "Record rent, salaries, purchases and other costs to see your net income." : undefined}
                action={canManage ? <Button onClick={() => setAdding(true)}><PlusIcon /> Add Expense</Button> : undefined}
              />
            }
          />
          {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
        </div>
      )}

      {adding && <AddExpenseDialog onClose={() => setAdding(false)} />}
      {voiding && <VoidExpenseDialog expense={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function AddExpenseDialog({ onClose }: { onClose: () => void }) {
  const today = useTodayKey();
  const branches = (useLiveBranchList().data ?? []).filter((b) => b.status === "active");
  const create = useCreateLiveExpense();
  const [form, setForm] = useState({ category: "other" as LiveExpenseCategory, branchId: "", description: "", amount: "", date: today, paidTo: "", reference: "" });
  const branchId = form.branchId || branches[0]?.id || "";
  const amount = Number(form.amount);
  const valid = Boolean(branchId && form.description.trim() && Number.isFinite(amount) && amount > 0 && form.date);

  function save() {
    if (!valid) {
      toast.error("Choose a branch and enter a description and an amount above zero.");
      return;
    }
    create.mutate(
      {
        branchId,
        category: form.category,
        description: form.description.trim(),
        amount,
        date: form.date,
        paidTo: form.paidTo.trim() || undefined,
        reference: form.reference.trim() || undefined,
      },
      { onSuccess: (e) => { toast.success(`Expense of ${formatCurrency(e.amount)} recorded.`); onClose(); } }
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>Record a clinic expense. Recorded expenses can be voided but not edited.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as LiveExpenseCategory }))}>
              <SelectTrigger className="w-full" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
              <SelectTrigger className="w-full" aria-label="Branch"><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input id="exp-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. October clinic rent" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-amount">Amount (₹)</Label>
            <Input id="exp-amount" type="number" inputMode="decimal" min={0.01} step={0.01} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-date">Date</Label>
            <Input id="exp-date" type="date" max={today} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-paidto">Paid to (optional)</Label>
            <Input id="exp-paidto" value={form.paidTo} onChange={(e) => setForm((f) => ({ ...f, paidTo: e.target.value }))} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-ref">Bill / receipt no. (optional)</Label>
            <Input id="exp-ref" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} maxLength={64} />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !valid}>{create.isPending ? "Saving…" : "Add expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidExpenseDialog({ expense, onClose }: { expense: LiveExpense; onClose: () => void }) {
  const voidExpense = useVoidLiveExpense();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this expense?</DialogTitle>
          <DialogDescription>
            {expense.description} · {formatCurrency(expense.amount)}. It stays in the list as voided and no longer counts in totals. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            voidExpense.mutate({ id: expense.id, reason: reason.trim() }, { onSuccess: () => { toast.success("Expense voided."); onClose(); } });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea id="void-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" maxLength={300} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={voidExpense.isPending || reason.trim().length < 3}>{voidExpense.isPending ? "Voiding…" : "Void expense"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
