"use client";

import { notFound } from "next/navigation";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ActivitySquareIcon,
  BadgeIndianRupeeIcon,
  BuildingIcon,
  CalculatorIcon,
  FlaskConicalIcon,
  HeadsetIcon,
  Loader2Icon,
  PillIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StethoscopeIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/auth";
import { useAuthStore } from "@/store/auth-store";
import type { UserRole } from "@/types";
import { cn } from "@/lib/utils";

const ROLE_ICONS: Record<UserRole, LucideIcon> = {
  super_admin: SparklesIcon,
  clinic_owner: BuildingIcon,
  clinic_admin: ShieldCheckIcon,
  branch_manager: BuildingIcon,
  doctor: StethoscopeIcon,
  receptionist: HeadsetIcon,
  nurse: ActivitySquareIcon,
  pharmacist: PillIcon,
  lab_staff: FlaskConicalIcon,
  billing_staff: BadgeIndianRupeeIcon,
  accountant: CalculatorIcon,
  patient: UserIcon,
};

export default function DevDemoAccountsPage() {
  // Hooks first (unconditionally), then the dev-mode gate — this route only exists to speed up local development/testing.
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  function quickLogin(email: string) {
    setPendingEmail(email);
    setTimeout(() => {
      const success = login(email, DEMO_PASSWORD);
      setPendingEmail(null);
      if (!success) {
        toast.error("Could not sign in with this demo account.");
        return;
      }
      const role = useAuthStore.getState().user?.role;
      router.push(role === "patient" ? "/portal" : "/dashboard");
    }, 400);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <Badge variant="outline" className="border-warning/30 bg-warning-muted text-warning">Development only</Badge>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Demo accounts</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        This page only exists in development — it is not reachable in a production build. All accounts share the password{" "}
        <span className="font-mono font-medium text-foreground">{DEMO_PASSWORD}</span>, or click a card to sign in instantly.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEMO_ACCOUNTS.map((account) => {
          const Icon = ROLE_ICONS[account.role];
          const isPending = pendingEmail === account.email;
          return (
            <Card
              key={account.email}
              role="button"
              tabIndex={0}
              onClick={() => quickLogin(account.email)}
              onKeyDown={(e) => e.key === "Enter" && quickLogin(account.email)}
              className={cn(
                "cursor-pointer gap-1.5 py-4 transition-colors hover:border-primary hover:bg-accent",
                pendingEmail && !isPending && "pointer-events-none opacity-60"
              )}
            >
              <CardContent className="flex flex-col gap-1.5 px-4">
                <div className="flex items-center justify-between">
                  <Icon className="h-4 w-4 text-primary" />
                  {isPending && <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                <p className="text-sm font-medium text-foreground">{account.label}</p>
                <p className="text-xs leading-snug text-muted-foreground">{account.description}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{account.email}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
