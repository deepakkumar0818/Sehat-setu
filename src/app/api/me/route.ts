import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth/session";
import { authErrorResponse } from "@/server/auth/http";

/**
 * The signed-in user's verified identity and clinic memberships — no clinical
 * data. 401 without a valid session, 403 if not provisioned, 503 if auth isn't
 * configured. Useful for checking a new user's setup end to end.
 */
export async function GET() {
  try {
    const identity = await requireIdentity();
    return NextResponse.json(
      {
        user: { id: identity.userId, name: identity.name, email: identity.email, status: identity.status },
        memberships: identity.memberships.map((m) => ({
          clinicId: m.clinicId,
          clinicName: m.clinicName,
          branchId: m.branchId,
          role: m.roleKey,
          status: m.status,
          permissionCount: m.permissions.length,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return authErrorResponse(err);
  }
}
