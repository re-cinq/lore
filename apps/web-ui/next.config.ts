import type { NextConfig } from "next";

import path from "node:path";

// Old paths (/pipeline, /assembly-lines) live on in GitHub Issues/PR bodies posted before the ADR-024/FR6.41 renames; permanent:false since a 301 can't be undone.
const LEGACY_REDIRECTS = [
  { source: "/pipeline", destination: "/assembly-runs", permanent: false },
  {
    source: "/pipeline/:path*",
    destination: "/assembly-runs/:path*",
    permanent: false,
  },
  {
    source: "/assembly-lines",
    destination: "/assembly-runs",
    permanent: false,
  },
  {
    source: "/assembly-lines/:path*",
    destination: "/assembly-runs/:path*",
    permanent: false,
  },
  {
    source: "/api/pipeline/:path*",
    destination: "/api/tasks/:path*",
    permanent: false,
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16 type-checks tests during build; they reach into libs/**, which the image and web-ui-build CI job lack.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  // Sass can't see the "@/" TS alias; src/ on the load path lets `@use "styles/tokens"` skip the ../ hops. Turbopack reads the modern API's loadPaths, not the legacy includePaths.
  sassOptions: { loadPaths: [path.join(process.cwd(), "src")] },
  serverExternalPackages: [
    "@google-cloud/storage",
    "octokit",
    "@octokit/auth-app",
  ],
  redirects: async () => LEGACY_REDIRECTS,
};

export default nextConfig;
