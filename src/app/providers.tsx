"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthFragmentGuard } from "@/components/auth/auth-fragment-guard";
import { ApiRequestError } from "@/lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() => {
    /** A session that expired mid-use: sign in again, then come back here. */
    const handleExpired = (error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.replace(`/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return true;
      }
      return false;
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError: (error) => void handleExpired(error) }),
      // Every failed save surfaces to the user; nothing fails silently.
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          if (handleExpired(error)) return;
          // A form that renders this mutation's errors itself (e.g. duplicate/confirmation prompts) opts out of the toast.
          if (mutation.meta?.inlineErrors) return;
          toast.error(error instanceof Error ? error.message : "Something went wrong.");
        },
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          // Don't retry auth or validation failures; a single retry for transient errors.
          retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && failureCount < 1,
        },
      },
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <AuthFragmentGuard />
        {children}
        <Toaster position="top-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
