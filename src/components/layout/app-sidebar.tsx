"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { NAV_CONFIG } from "@/lib/nav-config";
import { ROLE_LABELS } from "@/lib/permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useWaitingRoom } from "@/hooks/use-appointments";
import { useLiveUnreadCount, useUnreadCount } from "@/hooks/use-notifications";
import { useInventorySummary } from "@/hooks/use-inventory";
import { useUiStore } from "@/store/ui-store";
import { useLiveData } from "@/lib/data-source";

export function AppSidebar() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const role = user?.role ?? "clinic_admin";
  const groups = NAV_CONFIG[role];
  const activeBranchId = useUiStore((s) => s.activeBranchId);

  const live = useLiveData();
  const { data: waitingRoom } = useWaitingRoom(live ? (activeBranchId ?? undefined) : (activeBranchId ?? user?.branchId));
  // Demo mode: the in-browser store's count. Live: the clinic database (never the demo store).
  const { data: unreadCount } = useUnreadCount(role);
  const { data: liveUnread } = useLiveUnreadCount();
  // Only fetched for users whose navigation includes Inventory (the server checks the permission again).
  const showsInventory = groups.some((g) => g.items.some((i) => i.href === "/inventory"));
  const { data: inventorySummary } = useInventorySummary({ enabled: showsInventory });

  const badgeValues: Record<string, number | undefined> = {
    waitingCount: waitingRoom?.length,
    notificationCount: live ? liveUnread?.count || undefined : unreadCount,
    // Medicines needing attention: low, out of stock, and (live) expired stock awaiting write-off.
    lowStockCount: inventorySummary ? inventorySummary.lowStock + inventorySummary.outOfStock + (live ? inventorySummary.expired : 0) || undefined : undefined,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link href="/dashboard" className="group-data-[collapsible=icon]:hidden">
          <Logo dark size="sm" />
        </Link>
        <Link href="/dashboard" className="hidden group-data-[collapsible=icon]:flex">
          <Logo dark size="sm" showWordmark={false} />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.map((group, i) => (
          <SidebarGroup key={group.label ?? `group-${i}`}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const badge = item.badgeKey ? badgeValues[item.badgeKey] : undefined;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {Boolean(badge) && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-3 py-3">
        {user && (
          <Link href="/settings" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <PersonAvatar name={user.name} color={user.avatarColor} size="sm" />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">{ROLE_LABELS[user.role]}</p>
            </div>
          </Link>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
