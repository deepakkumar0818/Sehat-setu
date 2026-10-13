import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  logging: {
    // Dev mode otherwise prints every Server Function call WITH its arguments,
    // which puts sign-in passwords (signInAction) in plain text in the terminal log.
    serverFunctions: false,
  },
};

export default nextConfig;
