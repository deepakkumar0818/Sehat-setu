"use client";

import { toast } from "sonner";
import { LivePortalPayments } from "@/components/portal/live-portal-care";
import { useLiveData } from "@/lib/data-source";
import { WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useInvoices, useRecordPayment } from "@/hooks/use-billing";

function DemoPortalPaymentsPage() {
  const user = useCurrentUser();
  const { data, isLoading } = useInvoices({ patientId: user?.patientId, pageSize: 50 });
  const recordPayment = useRecordPayment();

  const outstanding = (data?.items ?? []).reduce((s, i) => s + (i.status !== "paid" ? i.balance : 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Your invoices and payment history." />

      <StatCard label="Total Outstanding" value={formatCurrency(outstanding)} tone={outstanding > 0 ? "warning" : "default"} isLoading={isLoading} />

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={WalletIcon} title="No invoices yet" />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border">
          {data.items.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{inv.id}</p>
                <p className="text-xs text-muted-foreground">{formatDate(inv.date)} · {formatCurrency(inv.total)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={inv.status} />
                {inv.balance > 0 && (
                  <Button
                    size="sm"
                    disabled={recordPayment.isPending}
                    onClick={() =>
                      recordPayment.mutate(
                        { invoiceId: inv.id, amount: inv.balance, method: "online" },
                        { onSuccess: () => toast.success("Payment successful.") }
                      )
                    }
                  >
                    Pay {formatCurrency(inv.balance)}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalPaymentsPage() {
  // Live (signed-in patient): their own records from the clinic database. Demo mode: the original mock page.
  return useLiveData() ? <LivePortalPayments /> : <DemoPortalPaymentsPage />;
}
