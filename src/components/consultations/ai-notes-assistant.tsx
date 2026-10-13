"use client";

import { useState } from "react";
import { CheckIcon, MicIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIPanel } from "@/components/shared/ai-panel";
import { useGenerateConsultationNotes } from "@/hooks/use-ai";
import type { ConsultationDraft } from "@/services/ai";

interface AINotesAssistantProps {
  onAccept: (draft: ConsultationDraft) => void;
}

export function AINotesAssistant({ onAccept }: AINotesAssistantProps) {
  const generate = useGenerateConsultationNotes();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed && !generate.data) {
    return (
      <Button variant="outline" size="sm" onClick={() => setDismissed(false)}>
        <MicIcon className="text-ai" /> Start AI Notes
      </Button>
    );
  }

  if (!generate.data) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <MicIcon className="h-4 w-4 text-ai" /> AI Consultation Assistant
        </p>
        <p className="text-sm text-muted-foreground">
          Simulate voice notes from the visit and let AI draft structured consultation fields for your review.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
            {generate.isPending ? "Transcribing…" : "Start AI Notes"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Not now</Button>
        </div>
      </div>
    );
  }

  const draft = generate.data;

  return (
    <AIPanel
      title="AI Draft"
      disclaimer="Review and edit before accepting into the consultation record."
      actions={
        <Button size="sm" variant="ghost" onClick={() => generate.mutate(undefined)} disabled={generate.isPending}>
          <RefreshCwIcon className="h-3.5 w-3.5" /> Regenerate
        </Button>
      }
    >
      <div className="rounded-md bg-background/60 p-2.5 text-xs italic text-muted-foreground">&ldquo;{draft.transcript}&rdquo;</div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chief Complaint</p>
        <p>{draft.chiefComplaint}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Symptoms</p>
        <p>{draft.symptoms.join(", ")}</p>
      </div>
      {draft.temperatureF && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vitals</p>
          <p>Temperature: {draft.temperatureF}°F</p>
        </div>
      )}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
        <p>{draft.history}</p>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onAccept(draft); generate.reset(); setDismissed(true); }}>
          <CheckIcon className="h-3.5 w-3.5" /> Accept into consultation
        </Button>
        <Button size="sm" variant="outline" onClick={() => { generate.reset(); setDismissed(true); }}>
          <XIcon className="h-3.5 w-3.5" /> Reject
        </Button>
      </div>
    </AIPanel>
  );
}
