"use client";

import { FileTextIcon, FolderOpenIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDocuments } from "@/hooks/use-clinical";

export default function PortalDocumentsPage() {
  const user = useCurrentUser();
  const { data, isLoading } = useDocuments({ patientId: user?.patientId, pageSize: 50 });

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="All your prescriptions, reports, and files in one place." />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={FolderOpenIcon} title="No documents yet" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.items.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><FileTextIcon className="h-4.5 w-4.5" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(doc.date)}</p>
              </div>
              <Badge variant="outline" className="capitalize">{doc.category.replace("_", " ")}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
