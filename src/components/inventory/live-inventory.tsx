"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BoxesIcon, PackagePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReceiveStockDialog } from "@/components/inventory/receive-stock-dialog";
import { formatDate } from "@/lib/format";
import { useBranches } from "@/hooks/use-branches";
import { useInventorySummary, useStock } from "@/hooks/use-inventory";
import type { MedicineStatus } from "@/types";
import type { StockRow } from "@/services/inventory";

/** Clinic-database inventory: one row per medicine per branch, stock held in batches. */
export function LiveInventory() {
  const router = useRouter();
  const branches = useBranches();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MedicineStatus | "all">("all");
  const [branchId, setBranchId] = useState("all");
  const [page, setPage] = useState(1);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useStock({ search, status, branchId, page, pageSize: 12 });
  const { data: summary, isLoading: summaryLoading } = useInventorySummary({ branchId: branchId === "all" ? undefined : branchId });
  // The live summary carries the server's view of the user's rights (a UI hint; the server re-checks every change).
  const canManage = Boolean(summary && "canManage" in summary && summary.canManage);

  const columns: DataTableColumn<StockRow>[] = [
    {
      key: "name",
      header: "Medicine",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name} <span className="text-muted-foreground">{r.strength}</span></p>
          <p className="text-xs capitalize text-muted-foreground">{r.dosageForm} · {r.genericName}</p>
        </div>
      ),
    },
    { key: "branch", header: "Branch", render: (r) => r.branchName },
    { key: "usable", header: "Usable stock", render: (r) => <span className="font-medium">{r.usableQuantity}</span> },
    { key: "expired", header: "Expired", render: (r) => (r.expiredQuantity > 0 ? <span className="text-danger">{r.expiredQuantity}</span> : "—") },
    { key: "batches", header: "Batches", render: (r) => r.batchCount },
    { key: "expiry", header: "Next expiry", render: (r) => (r.nearestExpiry ? formatDate(r.nearestExpiry) : "—") },
    { key: "reorder", header: "Reorder at", render: (r) => (r.reorderLevel > 0 ? r.reorderLevel : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const hasFilters = Boolean(search) || status !== "all" || branchId !== "all";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description={canManage ? "Medicine stock by branch, batch and expiry." : "Medicine stock by branch, batch and expiry (view only)."}
        actions={canManage ? <Button onClick={() => setReceiveOpen(true)}><PackagePlusIcon /> Receive Stock</Button> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Medicines stocked" value={summary ? String(summary.total) : "—"} isLoading={summaryLoading} />
        <StatCard label="Low Stock" value={summary ? String(summary.lowStock) : "—"} tone={summary && summary.lowStock > 0 ? "warning" : "default"} isLoading={summaryLoading} />
        <StatCard label="Out of Stock" value={summary ? String(summary.outOfStock) : "—"} tone={summary && summary.outOfStock > 0 ? "danger" : "default"} isLoading={summaryLoading} />
        <StatCard label="Expiring ≤ 30 days" value={summary ? String(summary.expiringSoon) : "—"} tone={summary && summary.expiringSoon > 0 ? "warning" : "default"} isLoading={summaryLoading} />
        <StatCard label="Expired stock" value={summary ? String(summary.expired) : "—"} tone={summary && summary.expired > 0 ? "danger" : "default"} isLoading={summaryLoading} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search medicine, generic name or batch..." />
        <div className="flex gap-2">
          {branches.length > 1 && (
            <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={status} onValueChange={(v) => { setStatus(v as MedicineStatus | "all"); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
              <SelectItem value="low_stock">Low Stock</SelectItem>
              <SelectItem value="in_stock">In Stock</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <QueryError error={error} what="Stock records" onRetry={() => refetch()} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(r) => `${r.branchId}:${r.medicineId}`}
            isLoading={isLoading}
            onRowClick={(r) => router.push(`/inventory/${r.branchId}/${r.medicineId}`)}
            className="rounded-none border-0"
            emptyState={
              <EmptyState
                icon={BoxesIcon}
                title={hasFilters ? "No stock matches these filters" : "No stock recorded yet"}
                description={hasFilters ? "Try changing your search or filters." : canManage ? "Receive a delivery to start tracking stock." : "Stock appears here once it's received."}
                action={!hasFilters && canManage ? <Button onClick={() => setReceiveOpen(true)}><PackagePlusIcon /> Receive Stock</Button> : undefined}
              />
            }
          />
          {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
        </div>
      )}

      <ReceiveStockDialog open={receiveOpen} onOpenChange={setReceiveOpen} onReceived={(b, m) => router.push(`/inventory/${b}/${m}`)} />
    </div>
  );
}
