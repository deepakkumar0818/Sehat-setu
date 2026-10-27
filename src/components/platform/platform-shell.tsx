import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PlatformSidebar } from "./platform-sidebar";
import { ChangePasswordButton } from "./change-password-dialog";

/** The super admin console's frame: the sidebar (sections, who is signed in, sign out) and a top bar. */
export function PlatformShell({ name, email, children }: { name: string; email: string; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PlatformSidebar name={name} email={email} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger aria-label="Show or hide the menu" />
            <span className="text-sm font-medium text-muted-foreground">Sehat Setu · Super admin</span>
          </div>
          <ChangePasswordButton email={email} />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
