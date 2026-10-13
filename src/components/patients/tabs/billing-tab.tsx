import Link from "next/link";
import { ReceiptIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { QueryError } from "@/components/shared/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { useInvoices } from "@/hooks/use-billing";

export function BillingTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useInvoices({ patientId, pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <QueryError error={error} what="Invoices" onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={ReceiptIcon} title="No invoices yet" description="Invoices for this patient will appear here." />;
  }

  return (
    <div className="divide-y rounded-lg border">
      {data.items.map((inv) => (
        <Link key={inv.id} href={`/billing/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{inv.invoiceNumber ?? inv.id}</p>
            <p className="text-xs text-muted-foreground">{formatDate(inv.date)} · {formatCurrency(inv.total)}{inv.balance > 0 ? ` · ${formatCurrency(inv.balance)} due` : ""}</p>
          </div>
          <StatusBadge status={inv.status} />
        </Link>
      ))}
    </div>
  );
}
