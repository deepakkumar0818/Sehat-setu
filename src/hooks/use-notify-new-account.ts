import { useMutation } from "@tanstack/react-query";

export interface NotifyNewAccountInput {
  name: string;
  email: string;
  phone?: string;
  role: string;
  password: string;
  branchName?: string;
}

export interface NotifyNewAccountResult {
  emailSent: boolean;
  emailError?: string;
  smsSent: boolean;
  smsError?: string;
}

async function notifyNewAccount(input: NotifyNewAccountInput): Promise<NotifyNewAccountResult> {
  const res = await fetch("/api/notify-new-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to send notifications.");
  }
  return res.json();
}

export function useNotifyNewAccount() {
  return useMutation({ mutationFn: notifyNewAccount });
}
