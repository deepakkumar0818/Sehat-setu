import "server-only";
import { Resend } from "resend";

// This module runs only on the server (the `server-only` import above makes
// any accidental client-side import fail the build). It's the one place in
// the app that talks to a real email/SMS provider, and the one place that
// ever sees the provider API keys — both are read from server-only env vars
// (never NEXT_PUBLIC_*), so they can't end up in the browser bundle.

export interface NewAccountNotificationInput {
  name: string;
  email: string;
  phone?: string;
  /** Human-readable role label, e.g. "Doctor" or "Receptionist". */
  role: string;
  password: string;
  branchName?: string;
}

export interface NotificationResult {
  emailSent: boolean;
  emailError?: string;
  smsSent: boolean;
  smsError?: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const CLINIC_NAME = "Sehat Setu";

function greetingName(name: string): string {
  return name.startsWith("Dr.") ? name : name;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function buildEmailHtml(raw: NewAccountNotificationInput): string {
  // Every interpolated value is user-supplied, so escape it before it goes into HTML.
  const input = { ...raw, name: escapeHtml(raw.name), email: escapeHtml(raw.email), role: escapeHtml(raw.role), password: escapeHtml(raw.password), branchName: raw.branchName && escapeHtml(raw.branchName) };
  const where = input.branchName ? ` at ${input.branchName}` : "";
  return `
  <div style="font-family:Inter,Arial,sans-serif;background:#F8FAFC;padding:32px 16px;">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;">
      <div style="background:#2563EB;padding:20px 28px;">
        <span style="color:#F8FAFC;font-size:18px;font-weight:700;">${CLINIC_NAME}</span>
      </div>
      <div style="padding:28px;">
        <h1 style="font-size:18px;color:#0F172A;margin:0 0 12px;">Hi ${greetingName(input.name)},</h1>
        <p style="font-size:14.5px;line-height:1.6;color:#334155;margin:0 0 20px;">
          You've been added as a <strong>${input.role}</strong>${where} on ${CLINIC_NAME}. You can sign in right away using the details below.
        </p>
        <div style="background:#F1F5F9;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
          <p style="margin:0 0 6px;font-size:13.5px;color:#475569;">Email<br><strong style="color:#0F172A;">${input.email}</strong></p>
          <p style="margin:0;font-size:13.5px;color:#475569;">Password<br><strong style="color:#0F172A;font-family:monospace;">${input.password}</strong></p>
        </div>
        <a href="${APP_URL}/login" style="display:inline-block;background:#2563EB;color:#F8FAFC;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Sign in to ${CLINIC_NAME}</a>
        <p style="font-size:12.5px;color:#94A3B8;margin-top:24px;">Please keep this password safe and avoid sharing it over insecure channels.</p>
      </div>
    </div>
  </div>`;
}

function buildSmsText(input: NewAccountNotificationInput): string {
  const where = input.branchName ? ` at ${input.branchName}` : "";
  return `${CLINIC_NAME}: You've been added as a ${input.role}${where}. Login: ${input.email} Password: ${input.password} Sign in: ${APP_URL}/login`;
}

async function sendAccountEmail(input: NewAccountNotificationInput): Promise<Pick<NotificationResult, "emailSent" | "emailError">> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { emailSent: false, emailError: "Email isn't set up yet (missing RESEND_API_KEY on the server)." };
  }
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Sehat Setu <onboarding@resend.dev>",
      to: input.email,
      subject: `You've been added to ${CLINIC_NAME}`,
      html: buildEmailHtml(input),
    });
    if (error) return { emailSent: false, emailError: error.message };
    return { emailSent: true };
  } catch (err) {
    return { emailSent: false, emailError: err instanceof Error ? err.message : "Unknown email error." };
  }
}

async function sendAccountSms(input: NewAccountNotificationInput): Promise<Pick<NotificationResult, "smsSent" | "smsError">> {
  if (!input.phone) {
    return { smsSent: false, smsError: "No phone number on file." };
  }
  const key = process.env.TEXTBELT_API_KEY || "textbelt"; // "textbelt" = free tier, 1 SMS/day/IP, no signup
  try {
    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: input.phone.replace(/[\s()-]/g, ""),
        message: buildSmsText(input),
        key,
      }),
    });
    const data: { success: boolean; error?: string; quotaRemaining?: number } = await res.json();
    if (!data.success) return { smsSent: false, smsError: data.error || "The SMS provider declined to send this message." };
    return { smsSent: true };
  } catch (err) {
    return { smsSent: false, smsError: err instanceof Error ? err.message : "Unknown SMS error." };
  }
}

export async function sendNewAccountNotifications(input: NewAccountNotificationInput): Promise<NotificationResult> {
  const [emailResult, smsResult] = await Promise.all([sendAccountEmail(input), sendAccountSms(input)]);
  return { ...emailResult, ...smsResult };
}
