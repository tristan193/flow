import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One product: Review / Pipeline / CIM are views of deals_next. Classic URLs redirect.
  async redirects() {
    return [
      {
        source: "/",
        destination: "/next",
        permanent: true,
      },
      {
        source: "/pipeline",
        destination: "/next/pipeline",
        permanent: true,
      },
      {
        source: "/pipeline/:path*",
        destination: "/next/pipeline",
        permanent: true,
      },
      {
        source: "/deals/:path*",
        destination: "/next/pipeline",
        permanent: true,
      },
      {
        source: "/import",
        destination: "/db",
        permanent: true,
      },
      {
        source: "/import/:path*",
        destination: "/db",
        permanent: true,
      },
    ];
  },

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
