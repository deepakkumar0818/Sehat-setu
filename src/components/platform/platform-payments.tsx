"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarRangeIcon, DownloadIcon, IndianRupeeIcon, ReceiptIcon, RepeatIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { StatCard } from "@/components/shared/stat-card";
import { usePlatformOverview, usePlatformPayments, usePlatformPaymentTotals } from "@/hooks/use-platform";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformLedgerPayment, PlatformPaymentTotals } from "@/lib/live-types";
import { PAYMENT_METHODS } from "./platform-shared";

// Money clinics have paid Sehat Setu: totals, the last 12 months, and every
// payment across all clinics. Payments are recorded on each clinic's page.

const monthLabel = (month: string, style: "short" | "long" = "short") =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC" });

export function PlatformPayments() {
  const overview = usePlatformOverview();
  const totals = usePlatformPaymentTotals();
  const [clinicId, setClinicId] = useState<string>("all");
  const ledger = usePlatformPayments(clinicId === "all" ? {} : { clinicId });
  const payments = ledger.data?.pages.flatMap((p) => p.payments) ?? [];
  const months = totals.data?.months ?? [];
  const thisMonth = months.at(-1);
  const lastMonth = months.at(-2);
  const year = thisMonth?.month.slice(0, 4);
  const thisYear = months.filter((m) => m.month.startsWith(year ?? "-")).reduce((s, m) => s + m.amount, 0);

  function exportCsv() {
    const cell = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? "" : String(v);
      return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
    };
    const head = ["Paid on", "Clinic code", "Clinic", "Amount", "Method", "Reference", "Months", "Covers from", "Covers to", "Recorded by", "Voided", "Void reason", "Notes"];
    const rows = payments.map((p) =>
      [p.paidOn, p.clinicCode, p.clinicName, p.amount, PAYMENT_METHODS[p.method], p.reference, p.months, p.periodFrom, p.periodTo, p.recordedBy, p.voidedAt ? "yes" : "", p.voidReason, p.notes].map(cell).join(",")
    );
    const url = URL.createObjectURL(new Blob(["﻿" + [head.map(cell).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sehat-setu-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="Money clinics have paid you. To record a payment, open the clinic and use Record payment."
        actions={<Button variant="outline" onClick={exportCsv} disabled={!payments.length}><DownloadIcon /> Export</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Received this month" value={thisMonth ? formatCurrency(thisMonth.amount) : "—"} icon={IndianRupeeIcon} isLoading={totals.isLoading} />
        <StatCard label="Last month" value={lastMonth ? formatCurrency(lastMonth.amount) : "—"} icon={CalendarRangeIcon} isLoading={totals.isLoading} />
        <StatCard label={year ? `So far in ${year}` : "This year"} value={totals.data ? formatCurrency(thisYear) : "—"} icon={ReceiptIcon} isLoading={totals.isLoading} />
        <StatCard label="Monthly recurring revenue" value={overview.data ? formatCurrency(overview.data.totals.mrr) : "—"} icon={RepeatIcon} isLoading={overview.isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Received per month</CardTitle>
          <CardDescription>The last 12 months, by the date the money was received. Voided payments aren&apos;t counted.</CardDescription>
        </CardHeader>
        <CardContent>
          {totals.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : totals.error ? (
            <QueryError error={totals.error} what="Totals" onRetry={() => totals.refetch()} />
          ) : (
            <MonthlyBars months={months} />
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">All payments</h2>
        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger className="h-8 w-56" aria-label="Clinic"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clinics</SelectItem>
            {overview.data?.clinics.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {ledger.isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : ledger.error ? (
        <QueryError error={ledger.error} what="Payments" onRetry={() => ledger.refetch()} />
      ) : payments.length === 0 ? (
        <EmptyState icon={IndianRupeeIcon} title="No payments yet" description="Open a clinic and use Record payment when it pays you." />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid on</TableHead>
                  <TableHead>Clinic</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Covers</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => <PaymentRow key={p.id} p={p} />)}
              </TableBody>
            </Table>
          </div>
          {ledger.hasNextPage && (
            <Button variant="outline" size="sm" onClick={() => ledger.fetchNextPage()} disabled={ledger.isFetchingNextPage}>
              {ledger.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentRow({ p }: { p: PlatformLedgerPayment }) {
  return (
    <TableRow className={p.voidedAt ? "opacity-60" : undefined}>
      <TableCell className="whitespace-nowrap">{formatDate(p.paidOn)}</TableCell>
      <TableCell>
        <Link href={`/platform/clinics/${p.clinicId}`} className="font-medium text-foreground hover:text-primary hover:underline">{p.clinicName}</Link>
        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{p.clinicCode}</span>
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", p.voidedAt && "line-through")}>
        {formatCurrency(p.amount)}
        {p.voidedAt && <Badge variant="outline" className="ml-2 text-muted-foreground" title={p.voidReason ?? undefined}>Voided</Badge>}
      </TableCell>
      <TableCell>
        {PAYMENT_METHODS[p.method]}
        {p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        {formatDate(p.periodFrom)} – {formatDate(p.periodTo)}
        <span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}</span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{p.recordedBy ?? "—"}</TableCell>
    </TableRow>
  );
}

/** One series, so no legend: thin bars from a common baseline, a tooltip on each, and the values as a list for screen readers. */
function MonthlyBars({ months }: { months: PlatformPaymentTotals["months"] }) {
  const max = Math.max(...months.map((m) => m.amount), 0);
  const [hover, setHover] = useState<string | null>(null);
  if (max === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nothing received in the last 12 months yet.</p>;
  return (
    <div>
      <div className="relative flex h-44 items-end gap-[2px] border-b" role="img" aria-label="Money received per month, last 12 months">
        {months.map((m) => {
          const pct = (m.amount / max) * 100;
          return (
            <div
              key={m.month}
              className="relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(m.month)}
              onMouseLeave={() => setHover(null)}
            >
              <div className={cn("w-full max-w-8 rounded-t-[4px] bg-primary transition-opacity", hover && hover !== m.month && "opacity-50")} style={{ height: `${m.amount > 0 ? Math.max(pct, 2) : 0}%` }} />
              {hover === m.month && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
                  <p className="font-medium">{monthLabel(m.month, "long")}</p>
                  <p className="tabular-nums">{formatCurrency(m.amount)} · {m.payments} payment{m.payments === 1 ? "" : "s"}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]" aria-hidden>
        {months.map((m) => <span key={m.month} className="flex-1 text-center text-[11px] text-muted-foreground">{monthLabel(m.month)}</span>)}
      </div>
      <ul className="sr-only">
        {months.map((m) => <li key={m.month}>{monthLabel(m.month, "long")}: {formatCurrency(m.amount)}, {m.payments} payments</li>)}
      </ul>
    </div>
  );
}
