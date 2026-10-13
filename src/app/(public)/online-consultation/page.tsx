import type { Metadata } from "next";
import { OnlineConsultationPageClient } from "@/components/public/online-consultation-page-client";

export const metadata: Metadata = {
  title: "Online Consultation | Sehat Setu",
  description: "Talk to a doctor from wherever you are with secure online consultations on Sehat Setu.",
};

export default function OnlineConsultationPage() {
  return <OnlineConsultationPageClient />;
}
