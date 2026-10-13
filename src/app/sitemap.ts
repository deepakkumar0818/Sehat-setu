import type { MetadataRoute } from "next";
import { getDb } from "@/store/data-store";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const db = getDb();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/doctors`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/specialties`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/online-consultation`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/for-clinics`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/clinics`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/login`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/register`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const doctorRoutes: MetadataRoute.Sitemap = db.doctors.map((doctor) => ({
    url: `${SITE_URL}/doctors/${doctor.id}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const clinicRoutes: MetadataRoute.Sitemap = db.branches.map((branch) => ({
    url: `${SITE_URL}/clinics/${branch.id}`,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...doctorRoutes, ...clinicRoutes];
}
