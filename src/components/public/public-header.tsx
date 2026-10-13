"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/shared/logo";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/doctors", label: "Find a Doctor" },
  { href: "/specialties", label: "Specialties" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/online-consultation", label: "Online Consultation" },
  { href: "/for-clinics", label: "For Clinics" },
];

export function PublicHeader() {
  const [scrolled, setScrolled] = useState(false);
  const user = useCurrentUser();
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const accountHref = user ? (user.role === "patient" ? "/portal" : "/dashboard") : "/login";
  const accountLabel = user ? (user.role === "patient" ? "My Portal" : "Dashboard") : "Login";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-all duration-300",
        scrolled ? "border-b bg-background/95 shadow-sm backdrop-blur" : "border-b border-transparent bg-background/60 backdrop-blur-sm"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0">
          <Logo size="sm" />
        </Link>

        <nav className="ml-4 hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative py-1.5 text-sm font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
                {active && <span className="absolute inset-x-0 -bottom-[1px] h-0.5 rounded-full bg-primary" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Button variant="ghost" asChild>
            <Link href={accountHref}>{accountLabel}</Link>
          </Button>
          <Button asChild>
            <Link href="/book">Book an Appointment</Link>
          </Button>
        </div>

        <div className="ml-auto lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <MenuIcon className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle><Logo size="sm" /></SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4">
                {NAV_LINKS.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <SheetClose key={link.href} asChild>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "rounded-md px-3 py-2.5 text-sm font-medium",
                          active ? "bg-accent text-primary" : "text-foreground hover:bg-muted"
                        )}
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  );
                })}
                <div className="my-2 border-t" />
                <SheetClose asChild>
                  <Link href={accountHref} className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted">
                    {accountLabel}
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Button asChild className="mt-2">
                    <Link href="/book">Book an Appointment</Link>
                  </Button>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
