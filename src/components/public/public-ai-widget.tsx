"use client";

import { useEffect, useState } from "react";
import { SparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AIChat } from "@/components/ai/ai-chat";
import { answerPublicQuestion } from "@/services/ai";

const SUGGESTED = [
  "Find a doctor",
  "Book an appointment",
  "How does online consultation work?",
  "What are consultation fees?",
];

/** Dispatched by any public page (e.g. an "Ask Sehat AI" button) to open this widget without duplicating its chat UI. */
export const OPEN_SEHAT_AI_EVENT = "sehat-ai:open";

export function PublicAiWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpenRequest = () => setOpen(true);
    window.addEventListener(OPEN_SEHAT_AI_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_SEHAT_AI_EVENT, onOpenRequest);
  }, []);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-ai text-white shadow-lg shadow-ai/30 hover:bg-ai/90"
        aria-label="Open Sehat AI assistant"
      >
        {open ? <XIcon className="h-6 w-6" /> : <SparklesIcon className="h-6 w-6" />}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Sehat AI</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col p-4">
            <AIChat
              title="Sehat AI"
              description="Your healthcare assistant"
              suggestedPrompts={SUGGESTED}
              onAsk={(q) => answerPublicQuestion(q)}
              className="h-full"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
