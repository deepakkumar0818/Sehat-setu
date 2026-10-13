import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config", () => {
  it("never logs Server Function arguments (sign-in passwords would appear in the dev terminal)", () => {
    expect(nextConfig.logging && nextConfig.logging.serverFunctions).toBe(false);
  });
});
