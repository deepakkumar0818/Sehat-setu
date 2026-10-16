"use client";

import Link from "next/link";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/logo";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";

/** `live`: a real signed-in patient — no shortcut to the AI assistant, which isn't connected to clinic records yet. */
export function PortalHeader({ live = false }: { live?: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <Link href="/portal" className="md:hidden"><Logo size="sm" /></Link>
      <div className="ml-auto flex items-center gap-1">
        {!live && (
          <Button variant="ghost" size="icon" className="text-ai" asChild>
            <Link href="/portal/ai-assistant" aria-label="AI assistant"><SparklesIcon className="h-5 w-5" /></Link>
          </Button>
        )}
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
