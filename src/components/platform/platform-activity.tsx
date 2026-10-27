"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import type { PlatformActivityKind } from "@/lib/live-types";
import { ActivityList } from "./platform-shared";

const KINDS: { value: PlatformActivityKind; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "platform", label: "Super admin actions" },
  { value: "problems", label: "Refusals & failures" },
];

/** Who did what across Sehat Setu: every super admin action, and every refusal or failure in any clinic. */
export function PlatformActivity() {
  const [kind, setKind] = useState<PlatformActivityKind>("all");
  return (
    <div className="space-y-5">
      <PageHeader title="Activity" description="Every super admin action, plus refused access and failed actions in any clinic. Newest first." />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <Button key={k.value} size="sm" variant={kind === k.value ? "secondary" : "ghost"} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </Button>
        ))}
      </div>
      <ActivityList kind={kind} />
    </div>
  );
}
