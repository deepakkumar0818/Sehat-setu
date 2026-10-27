"use client";

import { use } from "react";
import { PlatformClinicDetailView, type ClinicDialog } from "@/components/platform/platform-clinic-detail";

const DIALOGS: readonly ClinicDialog[] = ["edit", "plan", "payment", "admin"];

/** ?do=payment|plan|admin|edit opens that dialog (links from the clinics list). */
export default function PlatformClinicPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ do?: string }> }) {
  const { id } = use(params);
  const { do: action } = use(searchParams);
  const open = DIALOGS.find((d) => d === action) ?? null;
  return <PlatformClinicDetailView id={id} initialDialog={open} />;
}
