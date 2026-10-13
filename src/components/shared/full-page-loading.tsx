import { Logo } from "@/components/shared/logo";

export function FullPageLoading() {
  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-4 bg-background">
      <Logo size="lg" />
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  );
}
