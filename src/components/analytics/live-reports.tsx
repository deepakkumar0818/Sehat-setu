"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRangeIcon, DownloadIcon, InfoIcon, LockIcon, RadioIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { StatCard } from "@/components/shared/stat-card";
import { TrendBarChart } from "@/components/analytics/trend-bar-chart";
import { useTodayKey } from "@/lib/data-source";
import { formatDate } from "@/lib/format";
import { AGEING_BANDS, checkRange, presetRange, RANGE_PRESETS, REPORT_EXPORTS, type RangePreset, type ReportExportKey } from "@/lib/reports";
import { useDownloadReport, useFinancialReport, useOperationalReport } from "@/hooks/use-reports";
import type { FinancialReport, OperationalReport, ReportScope, ReportUnavailableReason } from "@/lib/live-types";
import type { ReportParams } from "@/lib/live-api";

// Clinic reports from the database (live staff app). Every figure comes from
// /api/v1/reports/*, which re-checks permissions, clinic and branch scope on
// each request. Nothing here falls back to demo data.

const UNAVAILABLE_TEXT: Record<ReportUnavailableReason, string> = {
  not_permitted: "Your role doesn't include access to these records.",
  no_reliable_timestamps: "No consultation in this period has consistent start and finish times, so an average would be a guess.",
};

const METHOD_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", online: "Online" };
const BAND_LABEL = new Map(AGEING_BANDS.map((b) => [b.key, b.label]));

/** Exact rupees (paise shown only when present). */
function money(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(paise / 100);
}
const count = (n: number) => n.toLocaleString("en-IN");
const percent = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);

export function LiveReports() {
  const today = useTodayKey();
  const [preset, setPreset] = useState<RangePreset | "custom">("last30");
  const [custom, setCustom] = useState(() => presetRange("last30", today));
  const [branchId, setBranchId] = useState("all");
  const [tab, setTab] = useState("operational");

  const range = preset === "custom" ? custom : presetRange(preset, today);
  const check = checkRange(range.from, range.to);
  const params: ReportParams = useMemo(() => ({ from: range.from, to: range.to, ...(branchId !== "all" ? { branchId } : {}) }), [range.from, range.to, branchId]);

  const operational = useOperationalReport(params, check.ok);
  const scope = operational.data?.scope;
  const financial = useFinancialReport(params, check.ok && Boolean(scope?.canViewFinancial) && tab === "financial");
  const download = useDownloadReport();

  const onDownload = (report: ReportExportKey) =>
    download.mutate(
      { report, params },
      { onSuccess: () => toast.success("Report downloaded."), onError: (e) => toast.error(e.message) }
    );

  const setDate = (key: "from" | "to", value: string) => {
    setCustom({ ...range, [key]: value });
    setPreset("custom");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clinic reports"
        description="Appointments, patients, doctor workload and collections for your clinic, by IST calendar day."
        actions={
          <>
            <Badge variant="outline" className="gap-1.5 text-success"><RadioIcon className="h-3 w-3" /> Live data</Badge>
            {scope?.canExport && <ExportMenu scope={scope} report={operational.data} disabled={!check.ok || download.isPending} onPick={onDownload} />}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 py-1 lg:flex-row lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="report-range">Period</Label>
            <Select value={preset} onValueChange={(v) => { if (v !== "custom") setCustom(presetRange(v as RangePreset, today)); setPreset(v as RangePreset | "custom"); }}>
              <SelectTrigger id="report-range" className="w-full sm:w-44"><CalendarRangeIcon className="text-muted-foreground" /><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="space-y-1.5">
              <Label htmlFor="report-from">From</Label>
              <Input id="report-from" type="date" value={range.from} max={range.to} onChange={(e) => setDate("from", e.target.value)} className="sm:w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to">To</Label>
              <Input id="report-to" type="date" value={range.to} min={range.from} onChange={(e) => setDate("to", e.target.value)} className="sm:w-40" />
            </div>
          </div>
          <BranchFilter scope={scope} value={branchId} onChange={setBranchId} />
        </CardContent>
        {!check.ok && <p role="alert" className="px-6 pb-4 text-sm text-danger">{check.error}</p>}
      </Card>

      {scope?.ownAppointmentsOnly && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><InfoIcon className="h-4 w-4" /> Showing only your own appointments.</p>
      )}

      {!check.ok ? null : operational.isError ? (
        <QueryError error={operational.error} what="Reports" onRetry={() => operational.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="operational">Operational</TabsTrigger>
            {scope?.canViewFinancial && <TabsTrigger value="financial">Financial</TabsTrigger>}
          </TabsList>
          <TabsContent value="operational" className="mt-4">
            <OperationalTab report={operational.data} isLoading={operational.isLoading} />
          </TabsContent>
          {scope?.canViewFinancial && (
            <TabsContent value="financial" className="mt-4">
              {financial.isError ? (
                <QueryError error={financial.error} what="Financial reports" onRetry={() => financial.refetch()} />
              ) : (
                <FinancialTab report={financial.data} isLoading={financial.isLoading || !financial.data} />
              )}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

function BranchFilter({ scope, value, onChange }: { scope?: ReportScope; value: string; onChange: (v: string) => void }) {
  if (!scope) return null;
  if (scope.branchLocked) {
    const name = scope.branches.find((b) => b.id === scope.branchId)?.name ?? "Your branch";
    return (
      <div className="space-y-1.5">
        <Label>Branch</Label>
        <p className="flex h-9 items-center gap-2 text-sm text-muted-foreground"><LockIcon className="h-3.5 w-3.5" /> {name}</p>
      </div>
    );
  }
  if (scope.branches.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="report-branch">Branch</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="report-branch" className="w-full sm:w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All branches</SelectItem>
          {scope.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ExportMenu({ scope, report, disabled, onPick }: { scope: ReportScope; report?: OperationalReport; disabled: boolean; onPick: (r: ReportExportKey) => void }) {
  const available = REPORT_EXPORTS.filter((e) => {
    if (e.section === "financial") return scope.canViewFinancial;
    return Boolean(report?.[e.section]);
  });
  if (available.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled}><DownloadIcon /> Export CSV</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>For the selected period and branch</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((e) => <DropdownMenuItem key={e.key} onSelect={() => onPick(e.key)}>{e.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Unavailable({ what, reason }: { what: string; reason: ReportUnavailableReason }) {
  return <EmptyState icon={LockIcon} title={`${what} aren't available to you`} description={UNAVAILABLE_TEXT[reason]} className="py-10" />;
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}

function useTrendMode(days: number): ["date" | "month", (m: "date" | "month") => void] {
  const [mode, setMode] = useState<"date" | "month" | null>(null);
  return [mode ?? (days > 62 ? "month" : "date"), setMode];
}

function TrendToggle({ value, onChange }: { value: "date" | "month"; onChange: (v: "date" | "month") => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as "date" | "month")}>
      <SelectTrigger className="h-8 w-28" aria-label="Group by"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="date">By day</SelectItem>
        <SelectItem value="month">By month</SelectItem>
      </SelectContent>
    </Select>
  );
}

function OperationalTab({ report, isLoading }: { report?: OperationalReport; isLoading: boolean }) {
  const a = report?.appointments;
  const reason = (section: "appointments" | "patients" | "workload") => report?.unavailable.find((u) => u.section === section)?.reason;
  const [mode, setMode] = useTrendMode(a?.daily.length ?? 0);
  const loading = isLoading || !report;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Appointments" value={a ? count(a.totals.total) : "—"} isLoading={loading} />
        <StatCard label="Completed" value={a ? count(a.totals.completed) : "—"} isLoading={loading} />
        <StatCard label="Cancelled" value={a ? count(a.totals.cancelled) : "—"} isLoading={loading} />
        <StatCard label="No-shows" value={a ? count(a.totals.noShow) : "—"} tone={a && a.totals.noShow > 0 ? "warning" : "default"} isLoading={loading} />
        <StatCard label="New patients" value={report?.patients ? count(report.patients.total) : "—"} isLoading={loading} />
      </div>

      {reason("appointments") ? (
        <Unavailable what="Appointment reports" reason={reason("appointments")!} />
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Appointments over time</CardTitle>
                <CardDescription>By scheduled date. Upcoming = scheduled or confirmed; in progress = checked in or in consultation.</CardDescription>
              </div>
              <TrendToggle value={mode} onChange={setMode} />
            </CardHeader>
            <CardContent>
              {a && a.totals.total === 0 ? (
                <EmptyState title="No appointments in this period" description="Try a different date range or branch." className="py-10" />
              ) : (
                <TrendBarChart
                  isLoading={loading}
                  xKey={mode}
                  data={mode === "month" ? a?.monthly : a?.daily}
                  stacked
                  series={[
                    { key: "completed", label: "Completed", color: "var(--success)" },
                    { key: "upcoming", label: "Upcoming", color: "var(--info)" },
                    { key: "inProgress", label: "In progress", color: "var(--warning)" },
                    { key: "cancelled", label: "Cancelled", color: "var(--muted-foreground)" },
                    { key: "noShow", label: "No-show", color: "var(--danger)" },
                  ]}
                />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SectionCard title="Appointments by branch">
              {loading ? <TableSkeleton /> : a!.byBranch.length === 0 ? <p className="text-sm text-muted-foreground">No appointments in this period.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Branch</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Cancelled</TableHead><TableHead className="text-right">No-shows</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {a!.byBranch.map((b) => (
                      <TableRow key={b.branchId}><TableCell className="font-medium">{b.branchName}</TableCell><TableCell className="text-right">{count(b.total)}</TableCell><TableCell className="text-right">{count(b.completed)}</TableCell><TableCell className="text-right">{count(b.cancelled)}</TableCell><TableCell className="text-right">{count(b.noShow)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
            <PatientsCard report={report} loading={loading} reason={reason("patients")} />
          </div>

          <WorkloadCard report={report} loading={loading} />
        </>
      )}
    </div>
  );
}

function PatientsCard({ report, loading, reason }: { report?: OperationalReport; loading: boolean; reason?: ReportUnavailableReason }) {
  if (reason) return <Unavailable what="Patient registration reports" reason={reason} />;
  const p = report?.patients;
  return (
    <SectionCard title="New patients" description="Patient records created in Sehat Setu in this period (counts only).">
      {loading || !p ? <TableSkeleton /> : p.total === 0 ? <p className="text-sm text-muted-foreground">No new patient records in this period.</p> : (
        <div className="space-y-4">
          <TrendBarChart xKey={p.daily.length > 62 ? "month" : "date"} data={p.daily.length > 62 ? p.monthly : p.daily} series={[{ key: "count", label: "New patients", color: "var(--chart-1)" }]} />
          <Table>
            <TableHeader><TableRow><TableHead>Branch</TableHead><TableHead className="text-right">New patients</TableHead></TableRow></TableHeader>
            <TableBody>
              {p.byBranch.map((b) => <TableRow key={b.branchId}><TableCell className="font-medium">{b.branchName}</TableCell><TableCell className="text-right">{count(b.count)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}

function WorkloadCard({ report, loading }: { report?: OperationalReport; loading: boolean }) {
  const w = report?.workload;
  const d = w?.duration;
  const durationNote = !d ? "" : d.available
    ? `Average consultation: ${d.avgMinutes} min across ${d.samples} timed consultation${d.samples === 1 ? "" : "s"}${d.excluded ? ` (${d.excluded} with inconsistent times excluded)` : ""}.`
    : `Consultation length isn't shown: ${UNAVAILABLE_TEXT[d.reason].charAt(0).toLowerCase()}${UNAVAILABLE_TEXT[d.reason].slice(1)}`;
  return (
    <SectionCard title="Doctor workload" description="No-show rate = no-shows ÷ (completed + no-shows); cancelled and upcoming appointments are left out.">
      {loading || !w ? <TableSkeleton /> : w.doctors.length === 0 ? <p className="text-sm text-muted-foreground">No appointments in this period.</p> : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead><TableHead className="text-right">Appointments</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Upcoming</TableHead><TableHead className="text-right">Cancelled</TableHead><TableHead className="text-right">No-shows</TableHead><TableHead className="text-right">No-show rate</TableHead>
                  {d?.available && <TableHead className="text-right">Avg. consultation</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {w.doctors.map((doc) => (
                  <TableRow key={doc.doctorId}>
                    <TableCell className="font-medium">{doc.doctorName}</TableCell>
                    <TableCell className="text-right">{count(doc.total)}</TableCell>
                    <TableCell className="text-right">{count(doc.completed)}</TableCell>
                    <TableCell className="text-right">{count(doc.upcoming)}</TableCell>
                    <TableCell className="text-right">{count(doc.cancelled)}</TableCell>
                    <TableCell className="text-right">{count(doc.noShow)}</TableCell>
                    <TableCell className="text-right">{percent(doc.noShowRate)}</TableCell>
                    {d?.available && <TableCell className="text-right">{doc.avgConsultationMinutes === null ? "—" : `${doc.avgConsultationMinutes} min`}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{durationNote}</p>
        </div>
      )}
    </SectionCard>
  );
}

function FinancialTab({ report, isLoading }: { report?: FinancialReport; isLoading: boolean }) {
  const c = report?.collections;
  const [mode, setMode] = useTrendMode(c?.daily.length ?? 0);
  const monthly = useMemo(() => {
    if (!c) return undefined;
    const by = new Map<string, { month: string; netPaise: number; refundedPaise: number }>();
    for (const d of c.daily) {
      const m = by.get(d.date.slice(0, 7)) ?? { month: d.date.slice(0, 7), netPaise: 0, refundedPaise: 0 };
      m.netPaise += d.netPaise;
      m.refundedPaise += d.refundedPaise;
      by.set(m.month, m);
    }
    return [...by.values()];
  }, [c]);
  const toRupeeRows = (rows?: { netPaise: number; refundedPaise: number }[]) => rows?.map((r) => ({ ...r, collected: r.netPaise / 100, refunded: r.refundedPaise / 100 }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Collected (net)" value={c ? money(c.netPaise) : "—"} isLoading={isLoading} />
        <StatCard label="Refunded" value={c ? money(c.refundedPaise) : "—"} tone={c && c.refundedPaise > 0 ? "warning" : "default"} isLoading={isLoading} />
        <StatCard label="Billed in period" value={report ? money(report.billed.invoicedPaise) : "—"} isLoading={isLoading} />
        <StatCard label={report ? `Outstanding (${formatDate(report.outstanding.asOf, "dd MMM")})` : "Outstanding"} value={report ? money(report.outstanding.totalPaise) : "—"} tone={report && report.outstanding.totalPaise > 0 ? "warning" : "default"} isLoading={isLoading} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Collections over time</CardTitle>
            <CardDescription>Payments received, by payment date. Refunds are shown on the original payment&apos;s date.</CardDescription>
          </div>
          <TrendToggle value={mode} onChange={setMode} />
        </CardHeader>
        <CardContent>
          {c && c.grossPaise === 0 ? (
            <EmptyState title="No payments in this period" description="Try a different date range or branch." className="py-10" />
          ) : (
            <TrendBarChart
              isLoading={isLoading}
              xKey={mode}
              data={toRupeeRows(mode === "month" ? monthly : c?.daily)}
              series={[{ key: "collected", label: "Collected (net)", color: "var(--chart-1)" }, { key: "refunded", label: "Refunded", color: "var(--danger)" }]}
              formatValue={(v) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Payment methods" description="Received payments in the period (failed and pending attempts aren't money received).">
          {isLoading || !c ? <TableSkeleton /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className="text-right">Payments</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Refunded</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.byMethod.map((m) => (
                  <TableRow key={m.method}><TableCell className="font-medium">{METHOD_LABEL[m.method] ?? m.method}</TableCell><TableCell className="text-right">{count(m.payments)}</TableCell><TableCell className="text-right">{money(m.netPaise)}</TableCell><TableCell className="text-right">{m.refundedPaise ? money(m.refundedPaise) : "—"}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard title="Outstanding by age" description={report ? `Open balances as of ${formatDate(report.outstanding.asOf)}, aged from the due date (or issue date). Not limited by the period.` : undefined}>
          {isLoading || !report ? <TableSkeleton /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Age</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {report.outstanding.bands.map((b) => (
                  <TableRow key={b.band}><TableCell className="font-medium">{BAND_LABEL.get(b.band)}</TableCell><TableCell className="text-right">{count(b.invoiceCount)}</TableCell><TableCell className="text-right">{money(b.balancePaise)}</TableCell></TableRow>
                ))}
                <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-semibold">{count(report.outstanding.invoiceCount)}</TableCell><TableCell className="text-right font-semibold">{money(report.outstanding.totalPaise)}</TableCell></TableRow>
              </TableBody>
            </Table>
          )}
        </SectionCard>

        {c && c.byBranch.length > 1 && (
          <SectionCard title="Collections by branch">
            <Table>
              <TableHeader><TableRow><TableHead>Branch</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Refunded</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.byBranch.map((b) => <TableRow key={b.branchId}><TableCell className="font-medium">{b.branchName}</TableCell><TableCell className="text-right">{money(b.netPaise)}</TableCell><TableCell className="text-right">{b.refundedPaise ? money(b.refundedPaise) : "—"}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          </SectionCard>
        )}

        <SectionCard title="How these figures are calculated">
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
            <li><span className="text-foreground">Collected (net)</span>: payments received in the period, by payment date. Each payment is counted once.</li>
            <li><span className="text-foreground">Refunded</span>: payments later refunded, counted on the original payment&apos;s date (the system doesn&apos;t record a separate refund date). Gross received = net + refunded{c ? ` = ${money(c.grossPaise)}` : ""}.</li>
            <li><span className="text-foreground">Billed in period</span>: the value of invoices issued in the period, excluding void invoices{report && report.billed.voidCount ? ` (${count(report.billed.voidCount)} void, ${money(report.billed.voidPaise)})` : ""}. Billing is not revenue until it&apos;s paid.</li>
            <li><span className="text-foreground">Outstanding</span>: unpaid balances of open invoices today, after partial payments. Void invoices owe nothing.</li>
            <li>Profit isn&apos;t shown: expenses aren&apos;t recorded in the clinic database yet.</li>
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
