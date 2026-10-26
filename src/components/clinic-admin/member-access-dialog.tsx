"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useUpdateMemberAccess } from "@/hooks/use-clinic-admin";
import { PERMISSION_MODULE_LABELS } from "@/data/permission-catalog";
import { ROLE_LABELS } from "@/lib/permissions";
import type { ClinicUsersPage, LiveClinicUser } from "@/lib/live-types";
import type { PermissionModule, UserRole } from "@/types";

// One person's role and permissions (Users & Roles). Ticked = what they can do:
// their role's defaults, plus anything added, minus anything removed. Saving
// sends only the differences from the (new) role's defaults; the database
// checks the caller and applies the result to every permission check.

const moduleLabel = (m: string) => PERMISSION_MODULE_LABELS[m as PermissionModule] ?? m.replace(/_/g, " ");
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

export function MemberAccessDialog({ user, page, onClose }: { user: LiveClinicUser; page: ClinicUsersPage; onClose: () => void }) {
  const update = useUpdateMemberAccess();
  const defaultsOf = (role: UserRole) => new Set(page.roleDefaults[role] ?? []);
  // What they can do now (the dialog is keyed by membership, so this is computed once per person).
  const [initial] = useState(() => {
    const set = defaultsOf(user.role);
    for (const k of user.revoked) set.delete(k);
    for (const k of user.granted) set.add(k);
    return set;
  });
  const [role, setRole] = useState<UserRole>(user.role);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial));

  const defaults = defaultsOf(role);
  const modules = useMemo(() => {
    const groups = new Map<string, ClinicUsersPage["permissions"]>();
    for (const p of page.permissions) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups.entries()];
  }, [page.permissions]);
  const changedCount = [...new Set([...checked, ...defaults])].filter((k) => checked.has(k) !== defaults.has(k)).length;
  const roleChanged = role !== user.role;
  const dirty = roleChanged || !sameSet(checked, initial);

  function pickRole(next: UserRole) {
    setRole(next);
    setChecked(defaultsOf(next)); // a new role starts from its own defaults
  }

  function toggle(key: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function save() {
    const granted = [...checked].filter((k) => !defaults.has(k));
    const revoked = [...defaults].filter((k) => !checked.has(k));
    const permissionsChanged = roleChanged ? granted.length + revoked.length > 0 : !sameSet(checked, initial);
    update.mutate(
      { membershipId: user.membershipId, role: roleChanged ? role : undefined, permissions: permissionsChanged ? { granted, revoked } : undefined },
      {
        onSuccess: () => {
          toast.success(`${user.name}'s access updated. It applies from their next click.`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Role & permissions</DialogTitle>
          <DialogDescription>Choose what {user.name} can do in your clinic.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <PersonAvatar name={user.name} color="#64748b" size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}{user.branchName ? ` · ${user.branchName}` : ""}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Role</Label>
          {user.canChangeRole ? (
            <Select value={role} onValueChange={(v) => pickRole(v as UserRole)}>
              <SelectTrigger className="w-full sm:w-64" aria-label="Role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {page.changeableRoles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-foreground">
              {ROLE_LABELS[user.role]}
              {user.role === "doctor" && <span className="text-muted-foreground"> · Doctors keep the Doctor role; you can still change their permissions below.</span>}
            </p>
          )}
          {roleChanged && <p className="text-xs text-muted-foreground">Permissions below are reset to the {ROLE_LABELS[role]} defaults.</p>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            Permissions {changedCount > 0 && <Badge variant="secondary" className="ml-1">{changedCount} changed from role</Badge>}
          </p>
          <Button variant="ghost" size="sm" disabled={changedCount === 0} onClick={() => setChecked(defaultsOf(role))}>
            <RotateCcwIcon /> Reset to role defaults
          </Button>
        </div>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {modules.map(([module, perms]) => (
            <fieldset key={module} className="rounded-lg border p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{moduleLabel(module)}</legend>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {perms.map((p) => {
                  const on = checked.has(p.key);
                  const differs = on !== defaults.has(p.key);
                  const id = `perm-${p.key}`;
                  return (
                    <div key={p.key} className="flex items-start gap-2">
                      <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(p.key, v === true)} className="mt-0.5" />
                      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm leading-tight" title={p.description ?? undefined}>
                        <span className="text-foreground">{p.name}</span>
                        {differs && <span className={on ? "ml-1.5 text-xs text-success" : "ml-1.5 text-xs text-destructive"}>{on ? "added" : "removed"}</span>}
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!dirty || update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
