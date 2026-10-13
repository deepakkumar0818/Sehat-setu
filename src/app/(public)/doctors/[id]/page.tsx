import type { Metadata } from "next";
import { getDb } from "@/store/data-store";
import { DoctorProfileClient } from "@/components/public/doctor-profile-client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doctor = getDb().doctors.find((d) => d.id === id);
  if (!doctor) return { title: "Doctor not found | Sehat Setu" };

  const title = `${doctor.name} — ${doctor.specialization} | Sehat Setu`;
  const description = `Book an appointment with ${doctor.name}, ${doctor.specialization} specialist with ${doctor.experienceYears} years of experience, on Sehat Setu.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "profile" },
  };
}

export default async function DoctorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doctor = getDb().doctors.find((d) => d.id === id);

  const jsonLd = doctor && {
    "@context": "https://schema.org",
    "@type": "Physician",
    name: doctor.name,
    medicalSpecialty: doctor.specialization,
    description: doctor.bio,
  };

  return (
    <>
      {jsonLd && (
        // eslint-disable-next-line react/no-danger
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      <DoctorProfileClient doctorId={id} />
    </>
  );
}
