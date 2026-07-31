import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The embedded Postgres used in local development ships a WebAssembly binary
  // that must be loaded at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],

  // The schema and seed files are read from disk at runtime, so they have to be
  // traced into the deployment output; nothing imports them as modules.
  outputFileTracingIncludes: {
    "/**": ["./db/**"],
  },
};

export default nextConfig;
