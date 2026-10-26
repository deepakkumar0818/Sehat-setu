"use client";

import { FlaskConicalIcon } from "lucide-react";
import { useLiveData } from "@/lib/data-source";
import { LiveLabTests } from "@/components/clinic-admin/live-lab-tests";
import { PageHeader } from "@/components/shared/page-header";
import { LAB_REPORT_TYPES } from "@/data/pools";

// Demo mode has no clinic database: it shows the built-in sample list, read-only.
function DemoLabTestsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Lab Tests" description="The tests doctors can order from a consultation (sample list)." />
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {LAB_REPORT_TYPES.map((name) => (
          <div key={name} className="flex items-center gap-3 p-3 sm:px-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConicalIcon className="h-4 w-4" /></span>
            <p className="font-medium text-foreground">{name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Live staff app: the clinic database. Demo mode keeps the in-browser sample data.
export default function ClinicLabTestsPage() {
  return useLiveData() ? <LiveLabTests /> : <DemoLabTestsPage />;
}
