"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOutIcon, RotateCcwIcon, SettingsIcon, UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ROLE_LABELS } from "@/lib/permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAuthStore } from "@/store/auth-store";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { useDataStore } from "@/store/data-store";

export function UserMenu() {
  const router = useRouter();
  const user = useCurrentUser();
  const logout = useAuthStore((s) => s.logout);
  const resetDemoData = useDataStore((s) => s.resetDemoData);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!user) return null;

  const profileHref = user.role === "patient" ? "/portal/profile" : "/settings";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2">
            <PersonAvatar name={user.name} color={user.avatarColor} size="sm" />
            <span className="hidden text-sm font-medium sm:inline">{user.name.split(" ")[0]}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium text-foreground">{user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]} · {user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push(profileHref)}>
            <UserIcon /> Profile
          </DropdownMenuItem>
          {user.role !== "patient" && (
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <SettingsIcon /> Settings
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setConfirmReset(true)}>
            <RotateCcwIcon /> Reset demo data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              logout();
              if (isSupabaseAuthEnabled()) {
                // Clears the Supabase session cookies server-side.
                await fetch("/auth/signout", { method: "POST" }).catch(() => undefined);
                router.replace("/login?reason=signed_out");
                router.refresh();
                return;
              }
              router.push("/login");
            }}
          >
            <LogOutIcon /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset demo data?"
        description="This regenerates all patients, appointments, prescriptions, and billing records with fresh sample data. Any changes you've made in this session will be lost."
        confirmLabel="Reset data"
        onConfirm={() => {
          resetDemoData();
          setConfirmReset(false);
          toast.success("Demo data has been reset.");
        }}
      />
    </>
  );
}
