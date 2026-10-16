import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import path from "node:path";
import { getSupabasePublicConfig, productionAuthConfigProblem } from "./src/lib/auth/config";
import { securityHeaders } from "./src/lib/security-headers";

export default function config(phase: string): NextConfig {
  // Fail closed: never ship a production build that silently falls back to demo mode.
  if (phase === PHASE_PRODUCTION_BUILD) {
    const problem = productionAuthConfigProblem(process.env);
    if (problem) throw new Error(problem);
  }

  return {
    turbopack: {
      root: path.resolve(__dirname),
    },
    experimental: {
      // Dev only: keep Turbopack's work in memory instead of a persistent disk
      // cache. On this project's hard disk the cache (2.5 GB) took minutes to
      // write and compact, and memory eviction made already-compiled routes
      // re-read it from disk, so revisits stalled behind "Compiling…".
      // NEXT_DEV_FS_CACHE=1 turns it back on (e.g. on an SSD, for warm restarts).
      // Production builds keep their cache (turbopackFileSystemCacheForBuild).
      turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE === "1",
    },
    poweredByHeader: false,
    logging: {
      // Dev mode otherwise prints every Server Function call WITH its arguments,
      // which puts sign-in passwords (signInAction) in plain text in the terminal log.
      serverFunctions: false,
    },
    // CSP, frame protection, Referrer-Policy, Permissions-Policy, HSTS (src/lib/security-headers.ts).
    async headers() {
      return securityHeaders({ isDev: phase === PHASE_DEVELOPMENT_SERVER, supabaseOrigin: getSupabasePublicConfig()?.url ?? null });
    },
  };
}
