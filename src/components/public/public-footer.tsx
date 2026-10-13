import Link from "next/link";
import { Logo } from "@/components/shared/logo";

const COLUMNS = [
  {
    heading: "Patients",
    links: [
      { href: "/doctors", label: "Find a Doctor" },
      { href: "/specialties", label: "Specialties" },
      { href: "/book", label: "Book Appointment" },
      { href: "/online-consultation", label: "Online Consultation" },
      { href: "/portal", label: "Patient Portal" },
      { href: "/portal/prescriptions", label: "Prescriptions" },
      { href: "/portal/reports", label: "Reports" },
    ],
  },
  {
    heading: "Clinics",
    links: [
      { href: "/for-clinics", label: "Clinic Management" },
      { href: "/for-clinics", label: "For Doctors" },
      { href: "/for-clinics", label: "For Clinics" },
      { href: "mailto:hello@sehatsetu.demo?subject=Sehat%20Setu%20demo%20request", label: "Request a Demo" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/", label: "About" },
      { href: "mailto:hello@sehatsetu.demo", label: "Contact" },
      { href: "/", label: "Careers" },
      { href: "/#faq", label: "Help Center" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/", label: "Privacy Policy" },
      { href: "/", label: "Terms of Service" },
      { href: "/", label: "Cookie Policy" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-1">
            <Logo size="sm" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">Connecting Care. Simplifying Healthcare.</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.heading}</p>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((link, i) => (
                  <li key={`${link.label}-${i}`}>
                    <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 border-t pt-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sehat Setu is a healthcare technology platform and does not replace professional medical advice, diagnosis, or treatment.
            This is a product prototype — doctors, clinics, and statistics shown are fictional demo data.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">© {new Date().getFullYear()} Sehat Setu. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
