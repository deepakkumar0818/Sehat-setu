"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, LockIcon, PlusIcon, ShieldIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { useCreateCustomRole, useDuplicateRoleAsCustom, useRolesForClinic, useUpdateCustomRolePermissions } from "@/hooks/use-roles";
import { useCurrentClinicId } from "@/hooks/use-current-clinic-id";
import { useCurrentUser } from "@/hooks/use-current-user";
import { PERMISSION_CATALOG, PERMISSION_MODULE_LABELS } from "@/data/permission-catalog";
import type { PermissionModule, Role } from "@/types";

const MODULE_ORDER: PermissionModule[] = [
  "clinic", "branch", "user", "role", "patient", "appointment", "medical_record",
  "prescription", "lab", "pharmacy", "billing", "reports", "online_consultation", "settings", "platform",
];

export default function ClinicRolesPage() {
  const clinicId = useCurrentClinicId();
  const user = useCurrentUser();
  const { data: roles = [], isLoading } = useRolesForClinic(clinicId);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");

  const createCustomRole = useCreateCustomRole();
  const duplicateRole = useDuplicateRoleAsCustom();
  const updatePermissions = useUpdateCustomRolePermissions();

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const [draftPermissions, setDraftPermissions] = useState<string[] | null>(null);
  const activePermissions = draftPermissions ?? selectedRole?.permissionKeys ?? [];
  const dirty = draftPermissions !== null;

  const grouped = useMemo(() => {
    const map = new Map<PermissionModule, typeof PERMISSION_CATALOG>();
    for (const perm of PERMISSION_CATALOG) {
      const list = map.get(perm.module) ?? [];
      list.push(perm);
      map.set(perm.module, list);
    }
    return MODULE_ORDER.filter((m) => map.has(m)).map((m) => ({ module: m, permissions: map.get(m)! }));
  }, []);

  function openRole(role: Role) {
    setSelectedRoleId(role.id);
    setDraftPermissions(null);
  }

  function closeRoleDialog() {
    setSelectedRoleId(null);
    setDraftPermissions(null);
  }

  function togglePermission(key: string) {
    if (selectedRole?.isSystemRole) return;
    const base = draftPermissions ?? selectedRole?.permissionKeys ?? [];
    setDraftPermissions(base.includes(key) ? base.filter((k) => k !== key) : [...base, key]);
  }

  function selectAll() {
    if (selectedRole?.isSystemRole) return;
    setDraftPermissions(PERMISSION_CATALOG.map((p) => p.key));
  }

  function clearAll() {
    if (selectedRole?.isSystemRole) return;
    setDraftPermissions([]);
  }

  function savePermissions() {
    if (!selectedRole || !user || draftPermissions === null) return;
    updatePermissions.mutate(
      { roleId: selectedRole.id, permissionKeys: draftPermissions, actor: { name: user.name, role: user.role } },
      {
        onSuccess: () => {
          toast.success("Permissions saved.");
          setDraftPermissions(null);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save permissions."),
      }
    );
  }

  function handleDuplicate(role: Role) {
    if (!user) return;
    duplicateRole.mutate(
      { roleId: role.id, newName: `${role.name} (Custom)`, actor: { name: user.name, role: user.role } },
      { onSuccess: (created) => { toast.success(`${created.name} created — editable now.`); openRole(created); } }
    );
  }

  function handleCreateCustomRole() {
    if (!clinicId || !user || !newRoleName.trim()) return;
    createCustomRole.mutate(
      { clinicId, name: newRoleName.trim(), description: newRoleDescription.trim() || "Custom role.", permissionKeys: [], actor: { name: user.name, role: user.role } },
      {
        onSuccess: (created) => {
          toast.success(`${created.name} created.`);
          setCreateOpen(false);
          setNewRoleName("");
          setNewRoleDescription("");
          openRole(created);
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Roles & Permissions" description="Control exactly what each role can see and do." actions={<Button onClick={() => setCreateOpen(true)}><PlusIcon /> Custom Role</Button>} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : roles.length === 0 ? (
        <EmptyState icon={ShieldIcon} title="No roles found" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => openRole(role)}
              className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{role.name}</p>
                {role.isSystemRole && <Badge variant="outline" className="gap-1 border-muted text-[10px] text-muted-foreground"><LockIcon className="h-2.5 w-2.5" /> SYSTEM ROLE</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>
              <p className="mt-2 text-xs font-medium text-primary">{role.permissionKeys.length} permissions</p>
            </button>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selectedRole)} onOpenChange={(open) => !open && closeRoleDialog()}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
          {selectedRole && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedRole.name}
                  {selectedRole.isSystemRole && <Badge variant="outline" className="gap-1 border-muted text-[10px] text-muted-foreground"><LockIcon className="h-2.5 w-2.5" /> SYSTEM ROLE</Badge>}
                </DialogTitle>
                <DialogDescription>
                  {selectedRole.isSystemRole
                    ? "System roles are protected from destructive changes. Duplicate it into a custom role to edit permissions."
                    : "Toggle exactly what this role can do."}
                </DialogDescription>
              </DialogHeader>

              {selectedRole.isSystemRole ? (
                <Button variant="outline" size="sm" className="w-fit" onClick={() => handleDuplicate(selectedRole)}>
                  <CopyIcon className="h-3.5 w-3.5" /> Duplicate to custom role
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
                  <Button variant="outline" size="sm" onClick={clearAll}>Clear All</Button>
                </div>
              )}

              <div className="space-y-5">
                {grouped.map(({ module, permissions }) => (
                  <div key={module}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{PERMISSION_MODULE_LABELS[module]}</p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {permissions.map((perm) => (
                        <label key={perm.key} className={`flex items-start gap-2 rounded-lg border p-2.5 ${selectedRole.isSystemRole ? "opacity-70" : "cursor-pointer hover:bg-muted/40"}`}>
                          <Checkbox
                            checked={activePermissions.includes(perm.key)}
                            disabled={selectedRole.isSystemRole}
                            onCheckedChange={() => togglePermission(perm.key)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-xs font-medium text-foreground">{perm.name}</span>
                            <span className="block text-[11px] text-muted-foreground">{perm.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {!selectedRole.isSystemRole && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDraftPermissions(null)} disabled={!dirty}>Discard</Button>
                  <Button onClick={savePermissions} disabled={!dirty || updatePermissions.isPending}>
                    {updatePermissions.isPending ? "Saving…" : "Save Permissions"}
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create custom role</DialogTitle>
            <DialogDescription>Start from no permissions and build it up.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input id="role-name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="e.g. Reception Manager" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea id="role-desc" rows={2} value={newRoleDescription} onChange={(e) => setNewRoleDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCustomRole} disabled={createCustomRole.isPending || !newRoleName.trim()}>
              {createCustomRole.isPending ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
