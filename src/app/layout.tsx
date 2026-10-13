import type { Metadata } from "next";
import { Inter, Geist_Mono, Caveat } from "next/font/google";
import { Providers } from "@/app/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Used sparingly for one or two decorative accent captions on the public
// marketing site (hero/story banner) — never for body copy or UI text.
const caveat = Caveat({
  variable: "--font-handwriting",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sehat Setu — Connecting Care. Simplifying Healthcare.",
  description: "Sehat Setu is a modern clinic management platform connecting clinics, doctors, staff, and patients in one ecosystem.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${caveat.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
