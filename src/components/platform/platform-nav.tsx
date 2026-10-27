"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/platform", label: "Clinics" },
  { href: "/platform/plans", label: "Plans" },
  { href: "/platform/activity", label: "Activity" },
] as const;

/** The console's sections; "Clinics" stays selected on a clinic's own page. */
export function PlatformNav() {
  const path = usePathname();
  const current = (href: string) => (href === "/platform" ? path === "/platform" || path.startsWith("/platform/clinics") : path.startsWith(href));
  return (
    <nav aria-label="Super admin" className="flex gap-1 overflow-x-auto">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current(l.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            current(l.href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
