import type { Metadata } from "next";
import { getDb } from "@/store/data-store";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DoctorProfileClient } from "@/components/public/doctor-profile-client";
import { LivePublicDoctorProfile } from "@/components/public/live-public-doctors";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { tryPublicDirectory } from "@/server/data/public-directory";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (isSupabaseAuthEnabled()) {
    await connection();
    const d = (await tryPublicDirectory())?.doctors.find((x) => x.id === id);
    return d ? { title: `${d.name} — ${d.specialty} | Sehat Setu`, description: `Book an appointment with ${d.name}, ${d.specialty}.` } : { title: "Doctor not found | Sehat Setu" };
  }
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
  if (isSupabaseAuthEnabled()) {
    // Live site: the clinic's real doctor, or 404 (never a sample profile).
    await connection();
    const directory = await tryPublicDirectory();
    const live = directory?.doctors.find((d) => d.id === id);
    if (!directory || !live) notFound();
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <LivePublicDoctorProfile doctor={live} directory={directory} />
      </div>
    );
  }
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
