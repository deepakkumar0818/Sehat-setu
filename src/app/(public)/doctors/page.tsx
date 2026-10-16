import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicDoctorsPageClient } from "@/components/public/public-doctors-page-client";
import { LivePublicDoctors } from "@/components/public/live-public-doctors";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { tryPublicDirectory } from "@/server/data/public-directory";

export const metadata: Metadata = {
  title: "Find a Doctor | Sehat Setu",
  description: "Browse our clinic's doctors by specialty and book an appointment in minutes.",
};

function DoctorsPageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Skeleton className="h-9 w-64" />
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}

/** Live site: the clinic's real doctors, read per request. */
async function LiveDoctorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const directory = await tryPublicDirectory();
  const q = (await searchParams).search;
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Find a doctor</h1>
      <p className="mt-2 text-muted-foreground">Choose a doctor and book a visit. You&apos;ll sign in or create your free patient account on the next step.</p>
      <div className="mt-8"><LivePublicDoctors directory={directory} initialSearch={typeof q === "string" ? q.slice(0, 100) : ""} /></div>
    </div>
  );
}

export default function PublicDoctorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<DoctorsPageFallback />}>
      {isSupabaseAuthEnabled() ? <LiveDoctorsPage searchParams={searchParams} /> : <PublicDoctorsPageClient />}
    </Suspense>
  );
}
