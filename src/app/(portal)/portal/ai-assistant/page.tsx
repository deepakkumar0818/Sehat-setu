"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { AIChat } from "@/components/ai/ai-chat";
import { answerPatientQuestion } from "@/services/ai";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUiStore } from "@/store/ui-store";

const SUGGESTED = [
  "When is my next appointment?",
  "Show my latest prescription.",
  "Is my report available?",
  "How much do I owe?",
  "How can I reschedule my appointment?",
];

export default function PortalAiAssistantPage() {
  const user = useCurrentUser();
  const pendingQuestion = useUiStore((s) => s.pendingAiQuestion);
  const setPendingAiQuestion = useUiStore((s) => s.setPendingAiQuestion);
  const [initialQuestion] = useState(pendingQuestion);

  useEffect(() => {
    if (pendingQuestion) setPendingAiQuestion(null);
  }, [pendingQuestion, setPendingAiQuestion]);

  if (!user?.patientId) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Sehat AI" description="Ask about your appointments, prescriptions, reports, and payments." />
      <AIChat
        title="Sehat AI"
        description="Your personal health assistant"
        suggestedPrompts={SUGGESTED}
        onAsk={(q) => answerPatientQuestion(user.patientId as string, q)}
        autoAsk={initialQuestion}
      />
    </div>
  );
}
