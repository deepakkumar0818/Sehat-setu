"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { NAV_CONFIG } from "@/lib/nav-config";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const { setOpenMobile } = useSidebar();
  const role = user?.role ?? "clinic_admin";
  const primaryItems = NAV_CONFIG[role].flatMap((g) => g.items).slice(0, 4);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center border-t bg-background/95 backdrop-blur md:hidden">
      {primaryItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate px-1">{item.label}</span>
          </Link>
        );
      })}
      <button
        onClick={() => setOpenMobile(true)}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-muted-foreground"
      >
        <MenuIcon className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
