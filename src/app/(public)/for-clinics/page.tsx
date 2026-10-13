import type { Metadata } from "next";
import { ForClinicsPageClient } from "@/components/public/for-clinics-page-client";

export const metadata: Metadata = {
  title: "For Clinics | Sehat Setu",
  description: "Sehat Setu helps clinics manage appointments, patients, prescriptions, records, payments, and everyday operations from one connected platform.",
};

export default function ForClinicsPage() {
  return <ForClinicsPageClient />;
}
