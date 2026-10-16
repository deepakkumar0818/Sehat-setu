import { describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";
import nextConfig from "../../next.config";

describe("next.config", () => {
  it.each([PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER])("never logs Server Function arguments (sign-in passwords would appear in the dev terminal): %s", (phase) => {
    const config = nextConfig(phase);
    expect(config.logging && config.logging.serverFunctions).toBe(false);
  });
});
