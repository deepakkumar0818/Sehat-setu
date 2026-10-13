import { CheckIcon, MinusIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPermissions, ROLE_LABELS, type Action, type Resource } from "@/lib/permissions";
import type { StaffRole } from "@/types";

const RESOURCES: Resource[] = ["patients", "appointments", "billing", "clinical_records", "prescriptions", "inventory", "reports"];
const ACTIONS: Action[] = ["view", "create", "edit", "delete"];

export function PermissionMatrix({ role }: { role: StaffRole }) {
  const permissions = getPermissions(role);

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            {ACTIONS.map((a) => <TableHead key={a} className="text-center capitalize">{a}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {RESOURCES.map((resource) => (
            <TableRow key={resource}>
              <TableCell className="font-medium capitalize">{resource.replace("_", " ")}</TableCell>
              {ACTIONS.map((action) => (
                <TableCell key={action} className="text-center">
                  {permissions[resource]?.includes(action) ? (
                    <CheckIcon className="mx-auto h-4 w-4 text-success" />
                  ) : (
                    <MinusIcon className="mx-auto h-4 w-4 text-muted-foreground/40" />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">Permissions shown for: <span className="font-medium text-foreground">{ROLE_LABELS[role]}</span></p>
    </div>
  );
}
