import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRestoreHold, readRestoreHold, removable, RESTORE_HOLD_SETTING } from "./p62-orphan-sweep";

// No database or Storage access: the hold reader gets a fake client.
describe("restore hold (fail closed)", () => {
  const set = (v: string) => [`app.settings.jwt_exp=3600`, `${RESTORE_HOLD_SETTING}=${v}`];

  it("is clear only when the database-wide setting AND this session both say exactly 'off'", () => {
    expect(evaluateRestoreHold(set("off"), "off")).toEqual({ active: false, reason: "off" });
  });

  it.each([
    ["not configured", null, null],
    ["not configured (other settings only)", ["app.settings.jwt_exp=3600"], null],
    ["on", set("on"), "on"],
    ["unrecognised value", set("OFF"), "OFF"],
    ["unrecognised value (empty)", set(""), ""],
    ["ambiguous (set twice)", [`${RESTORE_HOLD_SETTING}=off`, `${RESTORE_HOLD_SETTING}=on`], "off"],
    ["role or session override", set("off"), "on"],
    ["session value missing", set("off"), null],
  ])("%s → active", (_label, config, effective) => {
    expect(evaluateRestoreHold(config as string[] | null, effective as string | null).active).toBe(true);
  });

  it("an unreadable catalog, an error or an unexpected result means an active hold", async () => {
    await expect(readRestoreHold({ query: async () => { throw new Error("permission denied"); } } as never)).resolves.toMatchObject({ active: true });
    await expect(readRestoreHold({ query: async () => ({ rows: [] }) } as never)).resolves.toMatchObject({ active: true });
    await expect(readRestoreHold({ query: async () => ({ rows: [{ setconfig: set("off"), effective: "off" }] }) } as never)).resolves.toEqual({ active: false, reason: "off" });
  });
});

describe("no_row objects are never removed automatically", () => {
  it("only FAILED and stale UPLOADING objects are removable", () => {
    const list = [
      { key: "a/1", why: "no_row" as const },
      { key: "a/2", why: "failed" as const },
      { key: "a/3", why: "stale_uploading" as const },
    ];
    expect(removable(list).map((c) => c.why)).toEqual(["failed", "stale_uploading"]);
  });

  it("the apply path removes only removable() candidates, after checking the hold, and re-checks the hold per object", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "p62-orphan-sweep.ts"), "utf8");
    const apply = src.slice(src.indexOf("async function main"));
    const holdThrow = apply.indexOf("if (hold.active) throw");
    const secret = apply.indexOf("SUPABASE_SECRET_KEY");
    const loop = apply.indexOf("for (const c of toRemove)");
    const recheck = apply.indexOf("await readRestoreHold(db)", loop);
    const remove = apply.indexOf("storage.remove(");
    expect(apply).toMatch(/const toRemove = removable\(list\)/);
    expect(holdThrow).toBeGreaterThan(-1);
    expect(holdThrow).toBeLessThan(secret);
    expect(loop).toBeGreaterThan(holdThrow);
    expect(recheck).toBeGreaterThan(loop);
    expect(recheck).toBeLessThan(remove);
    expect(apply).not.toMatch(/for \(const c of list\)\s*\{[^}]*remove/);
    expect(src.match(/\.remove\(/g)).toHaveLength(1);
  });
});
