"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** /clinic/dashboard is the URL clinic onboarding lands on — it reuses the existing, fuller /dashboard rather than duplicating it. */
export default function ClinicDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
