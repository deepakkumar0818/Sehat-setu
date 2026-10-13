import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

// Loaded here (before test workers start) because ES imports are hoisted above any code in a test file.
config({ path: [".env.local", ".env"], quiet: true });

// Integration tests run real server modules against the live database (as the
// sehat_app runtime role, over verified TLS). Run with `npm run test:integration`.
// `server-only` is stubbed because it deliberately throws outside a React
// Server Components bundle.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "./src/test/server-only-stub.ts"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
