import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STEP_LABELS = ["Clinic", "Specialties", "Branch", "Owner", "Configure", "Review"];

export function OnboardingStepper({ currentStep }: { currentStep: number }) {
  return (
    <ol className="flex items-center justify-between gap-1 sm:gap-2">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const isDone = step < currentStep;
        const isActive = step === currentStep;
        return (
          <li key={label} className="flex flex-1 items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  isDone ? "bg-success text-white" : isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {isDone ? <CheckIcon className="h-3.5 w-3.5" /> : step}
              </span>
              <span className={cn("hidden text-xs font-medium sm:inline", isActive ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            </div>
            {step < STEP_LABELS.length && <span className={cn("h-px flex-1", isDone ? "bg-success" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
