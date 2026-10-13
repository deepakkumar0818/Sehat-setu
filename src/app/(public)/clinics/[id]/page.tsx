import type { Metadata } from "next";
import { getDb } from "@/store/data-store";
import { ClinicProfileClient } from "@/components/public/clinic-profile-client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const branch = getDb().branches.find((b) => b.id === id);
  if (!branch) return { title: "Clinic not found | Sehat Setu" };
  return {
    title: `${branch.name} — ${branch.city} | Sehat Setu`,
    description: `Find doctors and book an appointment at ${branch.name} in ${branch.city}.`,
  };
}

export default async function ClinicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClinicProfileClient clinicId={id} />;
}
