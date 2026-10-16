"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CalendarPlus, HeartPulse, Home, MenuIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isPortalLinkActive, LIVE_PORTAL_SECTIONS, MY_HEALTH_PATHS, portalNav } from "@/lib/nav-config";
import { useLiveData } from "@/lib/data-source";
import { cn } from "@/lib/utils";
import { PortalNavLinks } from "./portal-sidebar";

const DEMO_PRIMARY = ["/portal", "/portal/appointments", "/portal/prescriptions", "/portal/reports", "/portal/ai-assistant"];

/** Live: Home, Book, Appointments, My Health — and Menu for everything (grouped, as on desktop). */
const LIVE_TABS = [
  { label: "Home", href: "/portal", icon: Home, active: (p: string) => p === "/portal" },
  { label: "Book", href: "/portal/book", icon: CalendarPlus, active: (p: string) => isPortalLinkActive("/portal/book", p) },
  { label: "Appointments", href: "/portal/appointments", icon: CalendarDays, active: (p: string) => isPortalLinkActive("/portal/appointments", p) },
  { label: "My Health", href: "/portal/profile", icon: HeartPulse, active: (p: string) => MY_HEALTH_PATHS.some((h) => isPortalLinkActive(h, p)) },
];

const tabClass = (active: boolean) => cn("flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]", active ? "text-primary" : "text-muted-foreground");

export function PortalBottomNav() {
  const pathname = usePathname();
  const live = useLiveData();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!live) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center border-t bg-background/95 backdrop-blur md:hidden">
        {portalNav(false)
          .filter((i) => DEMO_PRIMARY.includes(i.href))
          .map((item) => (
            <Link key={item.href} href={item.href} className={tabClass(isPortalLinkActive(item.href, pathname))}>
              <item.icon className="h-5 w-5" />
              <span className="truncate px-1">{item.label}</span>
            </Link>
          ))}
      </nav>
    );
  }

  return (
    <>
      <nav aria-label="Portal shortcuts" className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {LIVE_TABS.map((t) => {
          const active = t.active(pathname);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
              <t.icon className="h-5 w-5" aria-hidden />
              <span className="truncate px-1">{t.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenuOpen(true)} className={tabClass(false)} aria-haspopup="dialog" aria-expanded={menuOpen}>
          <MenuIcon className="h-5 w-5" aria-hidden />
          <span>Menu</span>
        </button>
      </nav>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-xl pb-6">
          <SheetHeader className="text-left">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription className="sr-only">All patient portal pages</SheetDescription>
          </SheetHeader>
          <div className="px-2">
            <PortalNavLinks sections={LIVE_PORTAL_SECTIONS} pathname={pathname} onNavigate={() => setMenuOpen(false)} tone="sheet" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
