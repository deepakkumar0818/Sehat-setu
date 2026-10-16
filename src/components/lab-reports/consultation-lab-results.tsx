"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddLabResultDialog, LabStatusBadge } from "@/components/lab-reports/live-lab-reports";
import { useLabReports } from "@/hooks/use-documents";

// Live consultation → ordered lab tests (P6.2): each saved test shows its lab
// report's status, or an "Add result" action for roles that may add results.

export function ConsultationLabResults({ consultationId, patientId, tests }: { consultationId: string; patientId: string; tests: string[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);
  const { data } = useLabReports({ patientId, pageSize: 50 });
  if (!data || tests.length === 0) return null;
  const linked = data.items.filter((r) => r.consultationId === consultationId);
  const reportFor = (test: string) => linked.find((r) => r.testType.trim().toLowerCase() === test.trim().toLowerCase());

  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Results</p>
      {tests.map((test) => {
        const report = reportFor(test);
        return (
          <div key={test} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{test}</span>
            {report ? (
              <Link href={`/reports/${report.id}`} className="shrink-0"><LabStatusBadge status={report.status} /></Link>
            ) : data.canCreate ? (
              <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => setAdding(test)}><PlusIcon /> Add result</Button>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">No result yet</span>
            )}
          </div>
        );
      })}
      <AddLabResultDialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        patientId={patientId}
        consultationId={consultationId}
        defaultTestType={adding ?? undefined}
        onCreated={(id, readable) => readable && router.push(`/reports/${id}`)}
      />
    </div>
  );
}
