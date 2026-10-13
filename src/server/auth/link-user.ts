// First-sign-in linking of a Supabase Auth user to their INVITED application
// user. Pure (I/O injected) so the concurrency behaviour is unit-tested.
import type { VerifiedAuthUser } from "@/server/auth/authorize";

export interface LinkUserDeps<U> {
  /** Look up the application user by Supabase auth id (RLS: own row only). */
  findByAuthId: () => Promise<U | null>;
  /** app.link_auth_user(): returns the linked user id, or null if nothing was linked by THIS call. */
  link: () => Promise<string | null>;
}

export async function findOrLinkUser<U>(authUser: VerifiedAuthUser, deps: LinkUserDeps<U>): Promise<{ user: U | null; linkedNow: boolean }> {
  const existing = await deps.findByAuthId();
  if (existing) return { user: existing, linkedNow: false };
  if (!authUser.email || !authUser.emailConfirmed) return { user: null, linkedNow: false };

  const linkedId = await deps.link();
  // Re-read even when this call linked nothing: concurrent requests from the
  // same first sign-in (e.g. router.replace + router.refresh) race to link;
  // the losers update 0 rows but must still see the winner's committed link.
  const user = await deps.findByAuthId();
  return { user, linkedNow: Boolean(linkedId && user) };
}
