"use client";

import { useState } from "react";
import { BoxesIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MedicineFormDialog } from "@/components/inventory/medicine-form-dialog";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { LiveInventory } from "@/components/inventory/live-inventory";
import { useLiveData } from "@/lib/data-source";
import { formatDate } from "@/lib/format";
import { useInventorySummary, useMedicines } from "@/hooks/use-inventory";
import type { MedicineStatus } from "@/types";
import type { MedicineWithStatus } from "@/services/inventory";

export default function InventoryPage() {
  // Live (Supabase mode): the clinic database's branch stock. Demo mode: the mock medicine list below.
  return useLiveData() ? <LiveInventory /> : <DemoInventory />;
}

function DemoInventory() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MedicineStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<MedicineWithStatus | null>(null);

  const { data, isLoading } = useMedicines({ search, status, page, pageSize: 12 });
  const { data: summary, isLoading: summaryLoading } = useInventorySummary();

  const columns: DataTableColumn<MedicineWithStatus>[] = [
    { key: "name", header: "Medicine", render: (m) => <span className="font-medium text-foreground">{m.name}</span> },
    { key: "batch", header: "Batch", render: (m) => m.batchNumber },
    { key: "stock", header: "Stock", render: (m) => `${m.stock} ${m.unit}` },
    { key: "expiry", header: "Expiry", render: (m) => formatDate(m.expiryDate) },
    { key: "supplier", header: "Supplier", render: (m) => m.supplier },
    { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
    { key: "actions", header: "", render: (m) => <Button size="sm" variant="outline" onClick={() => setAdjustTarget(m)}>Adjust</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Track medicine stock, expiry, and suppliers."
        actions={<Button onClick={() => setAddOpen(true)}><PlusIcon /> Add Medicine</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Medicines" value={summary ? String(summary.total) : "—"} isLoading={summaryLoading} />
        <StatCard label="Low Stock" value={summary ? String(summary.lowStock) : "—"} tone={summary && summary.lowStock > 0 ? "warning" : "default"} isLoading={summaryLoading} />
        <StatCard label="Out of Stock" value={summary ? String(summary.outOfStock) : "—"} tone={summary && summary.outOfStock > 0 ? "danger" : "default"} isLoading={summaryLoading} />
        <StatCard label="Expiring Soon" value={summary ? String(summary.expiringSoon) : "—"} tone={summary && summary.expiringSoon > 0 ? "warning" : "default"} isLoading={summaryLoading} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search medicines, batch, or supplier..." />
        <Select value={status} onValueChange={(v) => { setStatus(v as MedicineStatus | "all"); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="in_stock">In Stock</SelectItem>
            <SelectItem value="low_stock">Low Stock</SelectItem>
            <SelectItem value="out_of_stock">Out of Stock</SelectItem>
            <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(m) => m.id}
          isLoading={isLoading}
          className="rounded-none border-0"
          emptyState={
            <EmptyState
              icon={BoxesIcon}
              title="No medicines found"
              description="Try changing your filters or add a new medicine."
              action={<Button onClick={() => setAddOpen(true)}><PlusIcon /> Add Medicine</Button>}
            />
          }
        />
        {data && data.items.length > 0 && <DataTablePagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
      </div>

      <MedicineFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <AdjustStockDialog open={Boolean(adjustTarget)} onOpenChange={(open) => !open && setAdjustTarget(null)} medicine={adjustTarget} />
    </div>
  );
}
