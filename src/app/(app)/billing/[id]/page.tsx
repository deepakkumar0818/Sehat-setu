"use client";

import { use, useState } from "react";
import { toast } from "sonner";
import { BanIcon, DownloadIcon, PrinterIcon, Undo2Icon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Logo } from "@/components/shared/logo";
import { RecordPaymentDialog } from "@/components/billing/record-payment-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useLiveData } from "@/lib/data-source";
import { useInvoice, useRefundPayment, useVoidInvoice } from "@/hooks/use-billing";
import { useDataStore } from "@/store/data-store";
import type { Payment } from "@/types";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const live = useLiveData();
  const { data: invoice, isLoading, isError, refetch } = useInvoice(id);
  // Demo data keeps patient/branch details in the mock store; the clinic database returns them with the invoice.
  const demoBranch = useDataStore((s) => (!live && invoice ? s.db.branches.find((b) => b.id === invoice.branchId) : undefined));
  const demoPatient = useDataStore((s) => (!live && invoice ? s.db.patients.find((p) => p.id === invoice.patientId) : undefined));
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const voidInvoice = useVoidInvoice();
  const refund = useRefundPayment();

  if (isLoading) return <Skeleton className="h-[500px] w-full rounded-xl" />;
  if (isError || !invoice || (!live && !demoPatient)) return <ErrorState title="Couldn't load this invoice" onRetry={() => refetch()} />;

  const number = invoice.invoiceNumber ?? invoice.id;
  const billedTo = live
    ? { name: invoice.patientName, id: invoice.patientNumber ?? "", phone: invoice.patientPhone ?? "" }
    : { name: demoPatient!.name, id: demoPatient!.id, phone: demoPatient!.phone };
  const branch = live
    ? { name: invoice.branchName, address: invoice.branchAddress, phone: invoice.branchPhone }
    : { name: demoBranch?.name, address: demoBranch?.address, phone: demoBranch?.phone };
  const canCollect = live ? Boolean(invoice.capabilities?.recordPayment) : invoice.balance > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{number}</h1>
          <div className="mt-1"><StatusBadge status={invoice.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}><DownloadIcon /> Download PDF</Button>
          <Button variant="outline" onClick={() => window.print()}><PrinterIcon /> Print</Button>
          {invoice.capabilities?.void && (
            <Button variant="outline" onClick={() => setVoidOpen(true)}><BanIcon /> Void invoice</Button>
          )}
          {canCollect && (
            <Button onClick={() => setPaymentOpen(true)}><WalletIcon /> Collect Payment</Button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border bg-card p-6 print:max-w-none print:rounded-none print:border-0 sm:p-8">
        <div className="flex items-start justify-between border-b pb-4">
          <Logo size="sm" />
          <div className="text-right text-sm text-muted-foreground">
            <p>{branch.name}</p>
            <p>{branch.address}</p>
            <p>{branch.phone}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Billed to</p>
            <p className="font-semibold text-foreground">{billedTo.name}</p>
            <p className="text-muted-foreground">{[billedTo.id, billedTo.phone].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoice</p>
            <p className="font-semibold text-foreground">{number}</p>
            <p className="text-muted-foreground">Date: {formatDate(invoice.date)}</p>
          </div>
        </div>

        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((item, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{item.description}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{item.category.replace("_", " ")}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right text-muted-foreground">Subtotal</TableCell>
              <TableCell className="text-right">{formatCurrency(invoice.subtotal)}</TableCell>
            </TableRow>
            {invoice.discount > 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">Discount</TableCell>
                <TableCell className="text-right">−{formatCurrency(invoice.discount)}</TableCell>
              </TableRow>
            )}
            {invoice.tax > 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">Tax</TableCell>
                <TableCell className="text-right">+{formatCurrency(invoice.tax)}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell colSpan={4} className="text-right font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold">{formatCurrency(invoice.total)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} className="text-right text-muted-foreground">Paid</TableCell>
              <TableCell className="text-right text-success">{formatCurrency(invoice.paid)}</TableCell>
            </TableRow>
            {invoice.balance > 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">Balance due</TableCell>
                <TableCell className="text-right font-semibold text-danger">{formatCurrency(invoice.balance)}</TableCell>
              </TableRow>
            )}
          </TableFooter>
        </Table>
      </div>

      {invoice.payments && invoice.payments.length > 0 && (
        <div className="mx-auto max-w-2xl rounded-xl border bg-card p-4 print:hidden">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Payment history</h2>
          <div className="divide-y">
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{formatCurrency(p.amount)} · <span className="capitalize">{p.method.replace("_", " ")}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {p.paidAt ? new Date(p.paidAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : formatDate(p.date)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status} />
                  {invoice.capabilities?.refund && p.status === "success" && (
                    <Button variant="ghost" size="sm" onClick={() => setRefunding(p)}><Undo2Icon /> Mark refunded</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RecordPaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} invoice={invoice} />
      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={`Void ${number}?`}
        description="The invoice is kept for the record but can no longer be paid. This can't be undone."
        confirmLabel="Void invoice"
        destructive
        isLoading={voidInvoice.isPending}
        onConfirm={() => voidInvoice.mutate(invoice.id, { onSuccess: () => { toast.success("Invoice voided."); setVoidOpen(false); } })}
      />
      <ConfirmDialog
        open={refunding !== null}
        onOpenChange={(open) => !open && setRefunding(null)}
        title="Mark this payment as refunded?"
        description={`Records that ${refunding ? formatCurrency(refunding.amount) : ""} was returned to the patient. No money is moved by the app — make the refund first. The balance due is updated.`}
        confirmLabel="Mark refunded"
        destructive
        isLoading={refund.isPending}
        onConfirm={() => refunding && refund.mutate(refunding.id, { onSuccess: () => { toast.success("Payment marked as refunded."); setRefunding(null); } })}
      />
    </div>
  );
}
