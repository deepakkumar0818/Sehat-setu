"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ManualInvoiceDialog } from "@/components/billing/manual-invoice-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useBillingSummary, useInvoices, usePayments } from "@/hooks/use-billing";
import { useLiveData } from "@/lib/data-source";
import type { InvoiceStatus } from "@/types";
import type { InvoiceWithNames } from "@/services/billing";

export default function BillingPage() {
  const router = useRouter();
  const live = useLiveData();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useInvoices({ search, status, page, pageSize: 10 });
  const { data: payments, isLoading: paymentsLoading, isError: paymentsError, error: paymentsErr, refetch: refetchPayments } = usePayments({ page: paymentsPage, pageSize: 10 });
  const { data: summary, isLoading: summaryLoading } = useBillingSummary();
  // Live: the server says whether this user may create invoices (it re-checks on submit).
  const canCreate = !live || Boolean(summary?.canCreateInvoice);

  const invoiceColumns: DataTableColumn<InvoiceWithNames>[] = [
    { key: "id", header: "Invoice", render: (i) => <span className="font-medium text-foreground">{i.invoiceNumber ?? i.id}</span> },
    { key: "date", header: "Date", render: (i) => formatDate(i.date) },
    { key: "patient", header: "Patient", render: (i) => i.patientName },
    { key: "total", header: "Total", render: (i) => formatCurrency(i.total) },
    { key: "balance", header: "Balance", render: (i) => (i.balance > 0 ? formatCurrency(i.balance) : "—") },
    { key: "status", header: "Status", render: (i) => <StatusBadge status={i.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing"
        description="Invoices, payments, and outstanding balances."
        actions={canCreate ? <Button onClick={() => setDialogOpen(true)}><PlusIcon /> New Invoice</Button> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's Revenue" value={summary ? formatCurrency(summary.todaysRevenue) : "—"} isLoading={summaryLoading} />
        <StatCard label="Outstanding" value={summary ? formatCurrency(summary.outstandingBalance) : "—"} tone={summary && summary.outstandingBalance > 0 ? "warning" : "default"} isLoading={summaryLoading} />
        <StatCard label="Revenue this Month" value={summary ? formatCurrency(summary.totalRevenueThisMonth) : "—"} isLoading={summaryLoading} />
        <StatCard
          label={summary && summary.totalExpensesThisMonth === null ? "Expenses (not tracked yet)" : "Expenses this Month"}
          value={summary?.totalExpensesThisMonth != null ? formatCurrency(summary.totalExpensesThisMonth) : "—"}
          isLoading={summaryLoading}
        />
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={live ? "Search by invoice number, patient or patient ID..." : "Search by invoice ID or patient..."} />
            <Select value={status} onValueChange={(v) => { setStatus(v as InvoiceStatus | "all"); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partially Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                {live ? <SelectItem value="void">Void</SelectItem> : <SelectItem value="refunded">Refunded</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {isError ? (
            <ErrorState title="Couldn't load invoices" description={error.message} onRetry={() => refetch()} />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <DataTable
                columns={invoiceColumns}
                rows={data?.items ?? []}
                rowKey={(i) => i.id}
                isLoading={isLoading}
                onRowClick={(i) => router.push(`/billing/${i.id}`)}
                className="rounded-none border-0"
                emptyState={<EmptyState icon={ReceiptIcon} title="No invoices found" description="Try changing your filters or create a new invoice." />}
              />
              {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
            </div>
          )}
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          {paymentsError ? (
            <ErrorState title="Couldn't load payments" description={paymentsErr.message} onRetry={() => refetchPayments()} />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <DataTable
                columns={[
                  { key: "invoice", header: "Invoice", render: (p) => p.invoiceNumber ?? p.invoiceId },
                  { key: "date", header: "Date", render: (p) => formatDate(p.date) },
                  { key: "patient", header: "Patient", render: (p) => p.patientName },
                  { key: "amount", header: "Amount", render: (p) => formatCurrency(p.amount) },
                  { key: "method", header: "Method", render: (p) => <span className="capitalize">{p.method.replace("_", " ")}</span> },
                  { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
                ]}
                rows={payments?.items ?? []}
                rowKey={(p) => p.id}
                isLoading={paymentsLoading}
                className="rounded-none border-0"
                emptyState={<EmptyState icon={ReceiptIcon} title="No payments found" />}
              />
              {payments && payments.items.length > 0 && (
                <DataTablePagination page={paymentsPage} pageSize={payments.pageSize} total={payments.total} onPageChange={setPaymentsPage} />
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ManualInvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => router.push(`/billing/${id}`)} />
    </div>
  );
}
