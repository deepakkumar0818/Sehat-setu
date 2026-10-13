"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { PATIENT_PORTAL_NAV } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

export function PortalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-4 py-4">
        <Link href="/portal"><Logo dark size="sm" /></Link>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {PATIENT_PORTAL_NAV.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="px-4 py-4 text-xs text-sidebar-foreground/50">Connecting Care. Simplifying Healthcare.</p>
    </aside>
  );
}
