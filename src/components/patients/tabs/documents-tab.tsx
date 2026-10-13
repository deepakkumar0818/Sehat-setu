import { FileTextIcon, FolderOpenIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { useDocuments } from "@/hooks/use-clinical";

export function DocumentsTab({ patientId }: { patientId: string }) {
  const { data, isLoading } = useDocuments({ patientId, pageSize: 50 });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data || data.items.length === 0) {
    return <EmptyState icon={FolderOpenIcon} title="No documents yet" description="Prescriptions, reports, and other files will appear here." />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.items.map((doc) => (
        <div key={doc.id} className="flex items-start gap-3 rounded-lg border p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileTextIcon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
            <p className="text-xs text-muted-foreground">{formatDate(doc.date)} · {doc.sizeKb} KB</p>
          </div>
          <Badge variant="outline" className="capitalize">{doc.category.replace("_", " ")}</Badge>
        </div>
      ))}
    </div>
  );
}
