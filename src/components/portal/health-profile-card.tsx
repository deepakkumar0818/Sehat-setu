"use client";

import { createContext, useContext } from "react";
import { CheckCircle2Icon, ClipboardListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { IntakeState, IntakeStep } from "@/lib/patient-intake";

// The onboarding context (P6.5) and the portal home card that reopens the
// dialog. Kept apart from patient-onboarding.tsx so portal pages can show the
// card without importing the dialog or its Server Actions.

export interface OnboardingContextValue {
  state: Extract<IntakeState, { available: true }>;
  /** Opens the dialog; with `{ section: true }` only that step is edited (Save closes it). */
  openAt: (step?: IntakeStep, opts?: { section?: boolean }) => void;
}
export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/** The onboarding controls, or null outside a live patient portal / before the migration. */
export function useOnboarding(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}

/** Portal home card: complete or edit the health profile later. */
export function HealthProfileCard() {
  const onboarding = useOnboarding();
  if (!onboarding) return null;
  const { state, openAt } = onboarding;
  return (
    <Card data-testid="health-profile-card">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {state.completed ? <CheckCircle2Icon className="mt-0.5 h-5 w-5 text-success" aria-hidden /> : <ClipboardListIcon className="mt-0.5 h-5 w-5 text-primary" aria-hidden />}
          <div>
            <p className="text-sm font-medium text-foreground">{state.completed ? "Your health profile" : "Complete your health profile"}</p>
            <p className="text-sm text-muted-foreground">
              {state.completed
                ? "Keep your contact details, medical history and symptoms up to date for your next visit."
                : "A few details help your clinic prepare for your visit. It takes about five minutes."}
            </p>
          </div>
        </div>
        <Button variant={state.completed ? "outline" : "default"} onClick={() => openAt()} className="shrink-0">
          {state.completed ? "Review or update" : "Continue"}
        </Button>
      </CardContent>
    </Card>
  );
}
