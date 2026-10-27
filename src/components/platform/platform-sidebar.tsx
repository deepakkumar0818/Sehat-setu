"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityIcon, Building2Icon, IndianRupeeIcon, LayersIcon, LogOutIcon, SettingsIcon, ShieldCheckIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/logo";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { usePlatformOverview } from "@/hooks/use-platform";
import { clinicAlerts } from "@/lib/platform-insights";

const GROUPS = [
  {
    label: "Manage",
    items: [
      { href: "/platform", label: "Clinics", icon: Building2Icon, badge: true },
      { href: "/platform/payments", label: "Payments", icon: IndianRupeeIcon },
      { href: "/platform/plans", label: "Plans", icon: LayersIcon },
      { href: "/platform/activity", label: "Activity", icon: ActivityIcon },
    ],
  },
  { label: "Account", items: [{ href: "/platform/settings", label: "Settings", icon: SettingsIcon }] },
] as const;

/** "Clinics" stays selected on a clinic's own page. */
const isActive = (path: string, href: string) => (href === "/platform" ? path === "/platform" || path.startsWith("/platform/clinics") : path === href || path.startsWith(`${href}/`));

export function PlatformSidebar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  const { data } = usePlatformOverview();
  // Clinics with a problem that needs acting on (shared with the clinics page's cache).
  const attention = data?.clinics.filter((c) => clinicAlerts(c).some((a) => a.tone !== "info")).length;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link href="/platform" className="group-data-[collapsible=icon]:hidden">
          <Logo dark size="sm" />
        </Link>
        <Link href="/platform" className="hidden group-data-[collapsible=icon]:flex">
          <Logo dark size="sm" showWordmark={false} />
        </Link>
        <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-sidebar-accent px-2 py-0.5 text-xs font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden /> Super admin
        </span>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(path, item.href)} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {"badge" in item && Boolean(attention) && <SidebarMenuBadge title="Clinics that need attention">{attention}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-1 px-3 py-3">
        <Link
          href="/platform/settings"
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <PersonAvatar name={name || email} color="#2563eb" size="sm" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium text-sidebar-foreground">{name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{email}</p>
          </div>
        </Link>
        <form action="/auth/signout" method="post">
          <SidebarMenuButton type="submit" tooltip="Sign out" className="text-sidebar-foreground/80">
            <LogOutIcon />
            <span>Sign out</span>
          </SidebarMenuButton>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
