"use client";

import { useState } from "react";
import { PlusIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { ExpenseFormDialog } from "@/components/billing/expense-form-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useDemoBillingSummary, useExpenses } from "@/hooks/use-billing";
import type { Expense, ExpenseCategory } from "@/types";

const CATEGORIES: ExpenseCategory[] = ["rent", "salary", "utilities", "equipment", "medicine_purchase", "lab_expense", "marketing", "maintenance", "other"];

export default function ExpensesPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "all">("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useExpenses({ search, category, page, pageSize: 10 });
  // Expenses aren't in the clinic database yet, so this page stays entirely on demo data (with the demo notice).
  const { data: summary, isLoading: summaryLoading } = useDemoBillingSummary();
  const netIncome = summary ? summary.totalRevenueThisMonth - (summary.totalExpensesThisMonth ?? 0) : undefined;

  const columns: DataTableColumn<Expense>[] = [
    { key: "date", header: "Date", render: (e) => formatDate(e.date) },
    { key: "description", header: "Description", render: (e) => e.description },
    { key: "category", header: "Category", render: (e) => <Badge variant="outline" className="capitalize">{e.category.replace("_", " ")}</Badge> },
    { key: "paidTo", header: "Paid To", render: (e) => e.paidTo ?? "—" },
    { key: "amount", header: "Amount", render: (e) => formatCurrency(e.amount) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description="Track clinic expenses across categories and branches."
        actions={<Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Expense</Button>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Revenue this Month" value={summary ? formatCurrency(summary.totalRevenueThisMonth) : "—"} isLoading={summaryLoading} />
        <StatCard label="Expenses this Month" value={summary?.totalExpensesThisMonth != null ? formatCurrency(summary.totalExpensesThisMonth) : "—"} isLoading={summaryLoading} />
        <StatCard label="Net Income" value={netIncome !== undefined ? formatCurrency(netIncome) : "—"} tone={netIncome !== undefined && netIncome < 0 ? "danger" : "default"} isLoading={summaryLoading} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search expenses..." />
        <Select value={category} onValueChange={(v) => { setCategory(v as ExpenseCategory | "all"); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(e) => e.id}
          isLoading={isLoading}
          className="rounded-none border-0"
          emptyState={
            <EmptyState icon={WalletIcon} title="No expenses found" description="Try changing your filters or add a new expense." action={<Button onClick={() => setDialogOpen(true)}><PlusIcon /> Add Expense</Button>} />
          }
        />
        {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
      </div>

      <ExpenseFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
