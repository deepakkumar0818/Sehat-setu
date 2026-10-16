"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { isPortalLinkActive, portalNavSections, type PortalNavSection } from "@/lib/nav-config";
import { useLiveData } from "@/lib/data-source";
import { cn } from "@/lib/utils";

/** The grouped portal links, shared by the desktop sidebar and the phone's menu sheet. */
export function PortalNavLinks({ sections, pathname, onNavigate, tone = "sidebar" }: { sections: PortalNavSection[]; pathname: string; onNavigate?: () => void; tone?: "sidebar" | "sheet" }) {
  return (
    <nav aria-label="Patient portal" className="space-y-4">
      {sections.map((section, i) => (
        <div key={section.label ?? `top-${i}`} className="space-y-0.5">
          {section.label && (
            <p className={cn("px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider", tone === "sidebar" ? "text-sidebar-foreground/50" : "text-muted-foreground")}>
              {section.label}
            </p>
          )}
          {section.items.map((item) => {
            const active = isPortalLinkActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  tone === "sidebar"
                    ? active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                    : active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function PortalSidebar() {
  const pathname = usePathname();
  const sections = portalNavSections(useLiveData());

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-4 py-4">
        <Link href="/portal"><Logo dark size="sm" /></Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <PortalNavLinks sections={sections} pathname={pathname} />
      </div>
      <p className="px-4 py-4 text-xs text-sidebar-foreground/50">Connecting Care. Simplifying Healthcare.</p>
    </aside>
  );
}
