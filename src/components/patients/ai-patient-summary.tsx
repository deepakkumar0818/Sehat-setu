"use client";

import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIPanel } from "@/components/shared/ai-panel";
import { useGeneratePatientSummary } from "@/hooks/use-ai";

export function AIPatientSummary({ patientId }: { patientId: string }) {
  const generate = useGeneratePatientSummary();

  if (!generate.data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-8 text-center">
        <p className="text-sm text-muted-foreground">Get a quick AI-generated overview of this patient&apos;s recent history.</p>
        <Button onClick={() => generate.mutate(patientId)} disabled={generate.isPending}>
          <SparklesIcon /> {generate.isPending ? "Generating summary…" : "Generate AI Summary"}
        </Button>
      </div>
    );
  }

  const s = generate.data;
  return (
    <AIPanel
      title="AI Patient Summary"
      actions={
        <Button size="sm" variant="ghost" onClick={() => generate.mutate(patientId)} disabled={generate.isPending}>
          Regenerate
        </Button>
      }
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Patient Overview</p>
        <p>{s.overview}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent Visits</p>
        <p>{s.recentVisits}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Medications</p>
        <p>{s.currentMedications}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent Reports</p>
        <p>{s.recentReports}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent Clinical Notes</p>
        <p>{s.recentClinicalNotes}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up</p>
        <p>{s.followUp}</p>
      </div>
    </AIPanel>
  );
}
