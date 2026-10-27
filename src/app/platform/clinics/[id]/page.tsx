"use client";

import { use } from "react";
import { PlatformClinicDetailView } from "@/components/platform/platform-clinic-detail";

export default function PlatformClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PlatformClinicDetailView id={id} />;
}
