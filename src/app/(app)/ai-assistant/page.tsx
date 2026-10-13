"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { AIChat } from "@/components/ai/ai-chat";
import { answerClinicQuestion } from "@/services/ai";
import { useUiStore } from "@/store/ui-store";

const SUGGESTED = [
  "Which doctor has the most appointments?",
  "Why did revenue change this week?",
  "How many patients are waiting?",
  "Which medicines are low in stock?",
  "How many patients missed appointments?",
  "Show outstanding payments.",
  "Which services generated the most revenue?",
];

export default function AiAssistantPage() {
  const pendingQuestion = useUiStore((s) => s.pendingAiQuestion);
  const setPendingAiQuestion = useUiStore((s) => s.setPendingAiQuestion);
  const [initialQuestion] = useState(pendingQuestion);

  useEffect(() => {
    if (pendingQuestion) setPendingAiQuestion(null);
  }, [pendingQuestion, setPendingAiQuestion]);

  return (
    <div className="space-y-5">
      <PageHeader title="AI Assistant" description="Ask Sehat AI about your clinic's operations, revenue, and patients." />
      <AIChat
        title="Sehat AI"
        description="Clinic operations assistant"
        suggestedPrompts={SUGGESTED}
        onAsk={(q) => answerClinicQuestion(q)}
        autoAsk={initialQuestion}
      />
    </div>
  );
}
