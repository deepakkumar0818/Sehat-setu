"use client";

import { ErrorState } from "@/components/shared/error-state";

/** Shown if loading the dashboard fails (e.g. the database is unreachable). Details stay in the server log. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="Couldn't load the dashboard"
      description="We couldn't reach the clinic database. Please try again in a moment."
      onRetry={reset}
    />
  );
}
