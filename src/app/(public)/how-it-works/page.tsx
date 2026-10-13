import type { Metadata } from "next";
import { HowItWorksPageClient } from "@/components/public/how-it-works-page-client";

export const metadata: Metadata = {
  title: "How It Works | Sehat Setu",
  description: "See how Sehat Setu brings finding a doctor, booking appointments, consultations, and health records together in one place.",
};

export default function HowItWorksPage() {
  return <HowItWorksPageClient />;
}
