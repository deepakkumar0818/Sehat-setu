import { describe, expect, it, vi } from "vitest";
import { findOrLinkUser } from "./link-user";

const confirmed = { id: "auth-1", email: "deepak@example.com", emailConfirmed: true };
const USER = { id: "user-1" };

describe("findOrLinkUser (first sign-in linking)", () => {
  it("returns an already-linked user without calling link", async () => {
    const link = vi.fn();
    const result = await findOrLinkUser(confirmed, { findByAuthId: async () => USER, link });
    expect(result).toEqual({ user: USER, linkedNow: false });
    expect(link).not.toHaveBeenCalled();
  });

  it("links on first sign-in and reports it", async () => {
    let linked = false;
    const result = await findOrLinkUser(confirmed, {
      findByAuthId: async () => (linked ? USER : null),
      link: async () => ((linked = true), USER.id),
    });
    expect(result).toEqual({ user: USER, linkedNow: true });
  });

  it("still finds the user when a concurrent request won the race to link (the NOT_PROVISIONED bug)", async () => {
    // This request's first lookup ran before the other request committed its link;
    // its own link call then updates 0 rows and returns null.
    const lookups = [null, USER];
    const result = await findOrLinkUser(confirmed, {
      findByAuthId: async () => lookups.shift() ?? null,
      link: async () => null,
    });
    expect(result).toEqual({ user: USER, linkedNow: false }); // found, but not double-counted as "linked now"
  });

  it("never links an unconfirmed or missing email", async () => {
    const link = vi.fn();
    for (const authUser of [{ ...confirmed, emailConfirmed: false }, { ...confirmed, email: null }]) {
      expect(await findOrLinkUser(authUser, { findByAuthId: async () => null, link })).toEqual({ user: null, linkedNow: false });
    }
    expect(link).not.toHaveBeenCalled();
  });

  it("returns null when there is no invitation to link", async () => {
    expect(await findOrLinkUser(confirmed, { findByAuthId: async () => null, link: async () => null })).toEqual({ user: null, linkedNow: false });
  });
});
