import { ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { PlatformNav } from "./platform-nav";

/** The super admin console's frame: its sections, who is signed in, and sign out. */
export function PlatformShell({ name, email, children }: { name: string; email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size="sm" />
            <span className="hidden items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary lg:inline-flex">
              <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden /> Super admin
            </span>
            <PlatformNav />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm sm:block">
              <p className="font-medium text-foreground">{name}</p>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" size="sm">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
