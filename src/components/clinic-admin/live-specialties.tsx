"use client";

import { useState } from "react";
import { InfoIcon, StethoscopeIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError } from "@/components/shared/query-error";
import { SearchInput } from "@/components/shared/search-input";
import { useLiveSpecialtyUsage } from "@/hooks/use-clinic-admin";

// The specialty catalogue is shared by every clinic on Sehat Setu (doctors and
// departments pick from it), so clinics can't add or rename entries. This page
// shows which ones this clinic actually offers.

export function LiveSpecialties() {
  const [search, setSearch] = useState("");
  const query = useLiveSpecialtyUsage();
  const q = search.trim().toLowerCase();
  const rows = (query.data?.items ?? []).filter((s) => !q || s.name.toLowerCase().includes(q));
  const offered = rows.filter((s) => s.doctorCount > 0 || s.departmentCount > 0);
  const others = rows.filter((s) => s.doctorCount === 0 && s.departmentCount === 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Specialties" description="Which specialties this clinic offers, from your doctors and departments." />

      <div role="note" className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          A specialty counts as offered once a doctor or department uses it. Set a doctor&apos;s specialty when you invite them (Staff), or a department&apos;s in
          Departments. The list itself is shared by all clinics; ask Sehat Setu support if one is missing.
        </span>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search specialties..." className="sm:w-72" />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : query.error ? (
        <QueryError error={query.error} what="Specialties" onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={StethoscopeIcon} title="No specialties found" />
      ) : (
        <div className="space-y-6">
          <section aria-label="Offered">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Offered here ({offered.length})</p>
            {offered.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">None yet. Add doctors or departments to start offering specialties.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {offered.map((s) => (
                  <div key={s.id} className="rounded-xl border bg-card p-4">
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.doctorCount} doctor{s.doctorCount === 1 ? "" : "s"} · {s.departmentCount} department{s.departmentCount === 1 ? "" : "s"}
                    </p>
                    {s.description && <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
          {others.length > 0 && (
            <section aria-label="Not offered">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not offered yet ({others.length})</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((s) => (
                  <div key={s.id} className="rounded-xl border border-dashed bg-muted/20 p-4">
                    <p className="font-medium text-muted-foreground">{s.name}</p>
                    {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
