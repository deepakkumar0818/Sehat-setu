"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, KeyRoundIcon, Loader2Icon, MailIcon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DEMO_PASSWORD } from "@/lib/auth";
import { useNotifyNewAccount } from "@/hooks/use-notify-new-account";

interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  email: string;
  phone?: string;
  /** Human-readable role label shown in the email/SMS, e.g. "Doctor". */
  role: string;
  branchName?: string;
  onDone?: () => void;
}

function ChannelRow({
  icon: Icon,
  label,
  status,
  errorText,
}: {
  icon: typeof MailIcon;
  label: string;
  status: "pending" | "sent" | "failed";
  errorText?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground">{label}</span>
          {status === "pending" && <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {status === "sent" && (
            <span className="flex items-center gap-1 text-xs font-medium text-success">
              <CheckIcon className="h-3.5 w-3.5" /> Sent
            </span>
          )}
          {status === "failed" && (
            <span className="flex items-center gap-1 text-xs font-medium text-warning">
              <TriangleAlertIcon className="h-3.5 w-3.5" /> Not sent
            </span>
          )}
        </div>
        {status === "failed" && errorText && <p className="text-xs text-muted-foreground">{errorText}</p>}
      </div>
    </div>
  );
}

export function CredentialsDialog({ open, onOpenChange, name, email, phone, role, branchName, onDone }: CredentialsDialogProps) {
  const notify = useNotifyNewAccount();
  const sentForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (sentForRef.current === email) return;
    sentForRef.current = email;
    notify.mutate({ name, email, phone, role, branchName, password: DEMO_PASSWORD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email]);

  const copyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${DEMO_PASSWORD}`);
      toast.success("Credentials copied.");
    } catch {
      toast.error("Couldn't copy — copy them manually below.");
    }
  };

  const emailStatus = notify.isPending ? "pending" : notify.data?.emailSent ? "sent" : notify.data ? "failed" : "pending";
  const smsStatus = notify.isPending ? "pending" : notify.data?.smsSent ? "sent" : notify.data ? "failed" : "pending";

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) onDone?.(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{name} can now sign in</DialogTitle>
          <DialogDescription>
            {notify.isPending
              ? "Sending their sign-in details by email and SMS…"
              : "Here's what was sent to them, and the credentials for your own reference."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3">
          <ChannelRow icon={MailIcon} label="Email" status={emailStatus} errorText={notify.data?.emailError} />
          <ChannelRow icon={MessageSquareIcon} label="SMS" status={smsStatus} errorText={notify.data?.smsError} />
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-sm">
            <MailIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Email</span>
            <span className="ml-auto font-medium text-foreground">{email}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <KeyRoundIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Password</span>
            <span className="ml-auto font-mono font-medium text-foreground">{DEMO_PASSWORD}</span>
          </div>
        </div>

        {(emailStatus === "failed" || smsStatus === "failed") && (
          <p className="text-xs text-muted-foreground">
            Delivery didn&apos;t fully go through — copy the credentials below and share them yourself for now.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={copyCredentials}>
            <CopyIcon /> Copy credentials
          </Button>
          <Button onClick={() => { onOpenChange(false); onDone?.(); }}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
