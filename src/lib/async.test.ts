import { describe, expect, it } from "vitest";
import { matchesSearch, paginate } from "@/lib/async";

describe("matchesSearch", () => {
  it("matches case-insensitively across multiple fields", () => {
    expect(matchesSearch(["Rahul Sharma", "PT-10001"], "rahul")).toBe(true);
    expect(matchesSearch(["Rahul Sharma", "PT-10001"], "10001")).toBe(true);
  });

  it("returns false when no field matches", () => {
    expect(matchesSearch(["Rahul Sharma", "PT-10001"], "xyz")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesSearch(["anything"], "")).toBe(true);
  });

  it("tolerates undefined fields in the haystack", () => {
    expect(matchesSearch([undefined, "PT-10001"], "10001")).toBe(true);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("slices the correct page", () => {
    const page2 = paginate(items, 2, 10);
    expect(page2.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page2.total).toBe(25);
  });

  it("returns a partial final page", () => {
    const page3 = paginate(items, 3, 10);
    expect(page3.items).toEqual([21, 22, 23, 24, 25]);
  });
});
