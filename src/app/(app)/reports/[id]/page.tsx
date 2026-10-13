"use client";

import { use } from "react";
import { toast } from "sonner";
import { DownloadIcon, PrinterIcon, ShareIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/shared/error-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { AIPanel } from "@/components/shared/ai-panel";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { formatDate } from "@/lib/format";
import { useReport, useShareReport } from "@/hooks/use-clinical";
import { useSummarizeReport } from "@/hooks/use-ai";
import { cn } from "@/lib/utils";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: report, isLoading, isError, refetch } = useReport(id);
  const shareReport = useShareReport();
  const summarize = useSummarizeReport();

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (isError || !report) return <ErrorState title="Couldn't load this report" onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{report.title}</h1>
            <StatusBadge status={report.status} />
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <PersonAvatar name={report.patientName} color="var(--chart-1)" size="sm" /> {report.patientName} · {formatDate(report.date)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}><DownloadIcon /> Download</Button>
          <Button variant="outline" onClick={() => window.print()}><PrinterIcon /> Print</Button>
          <Button
            variant="outline"
            onClick={() => shareReport.mutate(report.id, { onSuccess: () => toast.success("Shared with patient.") })}
            disabled={report.sharedWithPatient || shareReport.isPending}
          >
            <ShareIcon /> {report.sharedWithPatient ? "Shared with patient" : "Share with patient"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Report details</CardTitle></CardHeader>
            <CardContent>
              {report.values.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parameter</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Reference range</TableHead>
                      <TableHead>Flag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.values.map((v) => (
                      <TableRow key={v.parameter}>
                        <TableCell className="font-medium">{v.parameter}</TableCell>
                        <TableCell>{v.value} {v.unit}</TableCell>
                        <TableCell className="text-muted-foreground">{v.range}</TableCell>
                        <TableCell>
                          <span className={cn("capitalize", v.flag === "normal" ? "text-muted-foreground" : v.flag === "high" ? "text-danger" : "text-warning")}>
                            {v.flag}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{report.notes || "No structured values attached to this report."}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!summarize.data ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center">
              <p className="text-sm text-muted-foreground">Get a plain-language explanation of this report.</p>
              <Button size="sm" onClick={() => summarize.mutate(report)} disabled={summarize.isPending}>
                <SparklesIcon /> {summarize.isPending ? "Analyzing…" : "Explain Report"}
              </Button>
            </div>
          ) : (
            <AIPanel title="AI Summary" disclaimer="This is not a medical diagnosis — discuss results with your doctor.">
              <p>{summarize.data.summary}</p>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key observations</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {summarize.data.keyObservations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Questions to discuss with your doctor</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {summarize.data.questionsToAsk.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            </AIPanel>
          )}
        </div>
      </div>
    </div>
  );
}
