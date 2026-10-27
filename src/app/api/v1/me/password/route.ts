import { identityRoute } from "@/server/api/route-handler";
import { changeOwnPassword } from "@/server/account-password";

/** Change your own password: { currentPassword, newPassword }. The current one is checked first. */
export const POST = identityRoute({ resource: "POST /api/v1/me/password" }, async ({ identity, request }) => changeOwnPassword(identity, await request.json()));
