import type { Metadata } from "next";
import { SpecialtiesPageClient } from "@/components/public/specialties-page-client";

export const metadata: Metadata = {
  title: "Specialties | Sehat Setu",
  description: "Explore medical specialties and find the right kind of care — from general medicine to cardiology, dermatology, pediatrics, and more.",
};

export default function SpecialtiesPage() {
  return <SpecialtiesPageClient />;
}
