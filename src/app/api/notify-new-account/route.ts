import { NextResponse } from "next/server";
import { sendNewAccountNotifications, type NewAccountNotificationInput } from "@/server/send-account-notifications";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";

// LEGACY (demo mode only). This route emailed/texted a password taken from the
// request body. With Supabase Auth enabled it is retired: it answers 410 Gone
// BEFORE reading the body, so no password is ever accepted, logged or sent.
// Staff now join through invitations (/api/v1/staff/invitations). The demo
// implementation is removed entirely in P7.
export async function POST(request: Request) {
  if (isSupabaseAuthEnabled()) {
    return NextResponse.json(
      { error: { code: "GONE", message: "Account emails are no longer sent from here. Invite staff from the Staff page instead." } },
      { status: 410, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  if (process.env.NODE_ENV === "production") {
    // Demo mode has no server-verifiable identity; refuse in production.
    return NextResponse.json({ error: "Authentication is required to send account notifications." }, { status: 503 });
  }

  let body: Partial<NewAccountNotificationInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.name || !body.email || !body.password || !body.role) {
    return NextResponse.json({ error: "Missing required fields: name, email, password, role." }, { status: 400 });
  }

  const result = await sendNewAccountNotifications({
    name: body.name,
    email: body.email,
    phone: body.phone,
    role: body.role,
    password: body.password,
    branchName: body.branchName,
  });

  return NextResponse.json(result);
}
