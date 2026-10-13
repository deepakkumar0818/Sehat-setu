"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CredentialsDialog } from "@/components/shared/credentials-dialog";
import { useCreateStaff } from "@/hooks/use-people";
import { useDataStore } from "@/store/data-store";
import { ROLE_LABELS } from "@/lib/permissions";
import type { StaffRole } from "@/types";
import { useLiveData } from "@/lib/data-source";

const ROLES: StaffRole[] = [
  "clinic_owner", "clinic_admin", "branch_manager", "receptionist", "nurse",
  "pharmacist", "lab_staff", "billing_staff", "accountant",
];

/**
 * DEMO ONLY: creates a mock staff member and shows the shared demo password.
 * Renders nothing with live data — real staff join through invitations.
 */
export function StaffFormDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const live = useLiveData();
  return live ? null : <DemoStaffFormDialog {...props} />;
}

function DemoStaffFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const branches = useDataStore((s) => s.db.branches);
  const createStaff = useCreateStaff();
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("receptionist");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [newAccount, setNewAccount] = useState<{ name: string; email: string; phone: string; role: StaffRole; branchId: string } | null>(null);

  const handleSave = () => {
    if (!name || !phone || !email || !branchId) return;
    createStaff.mutate(
      { name, role, branchId, phone, email },
      {
        onSuccess: (member) => {
          toast.success("Staff member added.");
          onOpenChange(false);
          setNewAccount({ name: member.name, email: member.email, phone: member.phone, role: member.role, branchId: member.branchId });
          setName(""); setPhone(""); setEmail("");
        },
      }
    );
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add staff member</DialogTitle>
          <DialogDescription>Add a new team member and assign their role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-phone">Phone</Label>
            <Input id="staff-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createStaff.isPending || !name || !phone || !email}>
            {createStaff.isPending ? "Saving…" : "Add staff"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {newAccount && (
      <CredentialsDialog
        open={Boolean(newAccount)}
        onOpenChange={(next) => !next && setNewAccount(null)}
        name={newAccount.name}
        email={newAccount.email}
        phone={newAccount.phone}
        role={ROLE_LABELS[newAccount.role]}
        branchName={branches.find((b) => b.id === newAccount.branchId)?.name}
        onDone={() => setNewAccount(null)}
      />
    )}
    </>
  );
}
