"use client";

import Link from "next/link";
import { SearchIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { BranchSelector } from "@/components/layout/branch-selector";
import { useUiStore } from "@/store/ui-store";
import { useCurrentUser } from "@/hooks/use-current-user";

export function TopHeader() {
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const user = useCurrentUser();
  const isStaff = user?.role !== "patient";

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      {isStaff && <BranchSelector />}

      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="ml-1 flex h-9 flex-1 items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:max-w-sm"
      >
        <SearchIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Search patients, appointments, reports…</span>
        <span className="sm:hidden">Search…</span>
        <kbd className="ml-auto hidden rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" className="hidden text-ai sm:inline-flex" asChild>
          <Link href={isStaff ? "/ai-assistant" : "/portal/ai-assistant"} aria-label="AI assistant">
            <SparklesIcon className="h-5 w-5" />
          </Link>
        </Button>
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
