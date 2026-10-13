"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PATIENT_PORTAL_NAV } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

const PRIMARY = PATIENT_PORTAL_NAV.filter((i) => ["/portal", "/portal/appointments", "/portal/prescriptions", "/portal/reports", "/portal/ai-assistant"].includes(i.href));

export function PortalBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center border-t bg-background/95 backdrop-blur md:hidden">
      {PRIMARY.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]", isActive ? "text-primary" : "text-muted-foreground")}
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate px-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
