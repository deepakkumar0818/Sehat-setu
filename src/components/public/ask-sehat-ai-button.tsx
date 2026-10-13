"use client";

import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OPEN_SEHAT_AI_EVENT } from "@/components/public/public-ai-widget";
import { cn } from "@/lib/utils";

/** Opens the floating Sehat AI widget (already mounted in the public layout) instead of duplicating its chat UI. */
export function AskSehatAiButton({ label = "Ask Sehat AI", className, size = "lg" as const }: { label?: string; className?: string; size?: "default" | "sm" | "lg" }) {
  return (
    <Button
      size={size}
      className={cn("bg-ai text-white hover:bg-ai/90", className)}
      onClick={() => window.dispatchEvent(new Event(OPEN_SEHAT_AI_EVENT))}
    >
      <SparklesIcon /> {label}
    </Button>
  );
}
