import { describe, expect, it } from "vitest";
import { parsePurgeArgs, RETENTION_DAYS } from "./purge-notifications";

describe("notification purge arguments", () => {
  it("is a dry run unless --apply is given", () => {
    expect(parsePurgeArgs([])).toEqual({ apply: false });
    expect(parsePurgeArgs(["--dry-run"])).toEqual({ apply: false });
    expect(parsePurgeArgs(["--apply"])).toEqual({ apply: true });
    expect(parsePurgeArgs(["--apply", "--dry-run"])).toEqual({ apply: false });
    expect(() => parsePurgeArgs(["--days=1"])).toThrow(/Unknown argument/);
    expect(RETENTION_DAYS).toBe(90);
  });
});
