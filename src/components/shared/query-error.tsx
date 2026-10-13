import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ApiRequestError } from "@/lib/api-client";

/**
 * A failed query, shown honestly: "not available to your role" for a 403
 * (instead of an empty list that would look like "no records"), otherwise the
 * error with a retry.
 */
export function QueryError({ error, what, onRetry }: { error: Error; what: string; onRetry: () => void }) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return <EmptyState icon={LockIcon} title={`${what} aren't available to you`} description="Your role doesn't include access to these records." />;
  }
  return <ErrorState title={`Couldn't load ${what.toLowerCase()}`} description={error.message} onRetry={onRetry} />;
}
