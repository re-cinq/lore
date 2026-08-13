import type { NextConfig } from "next";

import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // `@/` is a TypeScript path alias — Sass cannot see it. Putting src/ on the
  // load path lets a module write `@use "styles/tokens"` instead of counting
  // ../ hops back up from wherever it happens to live.
  sassOptions: { includePaths: [path.join(process.cwd(), "src")] },
  serverExternalPackages: [
    "@google-cloud/storage",
    "octokit",
    "@octokit/auth-app",
  ],
  // The tasks tab was renamed /pipeline → /assembly-lines (ADR-024 ubiquitous
  // language). Keep the old paths alive: GitHub Issues / PR bodies posted before
  // the rename embed /pipeline/<task-id> links via libs/shared linkifyMarkdown.
  redirects: async () => [
    { source: "/pipeline", destination: "/assembly-lines", permanent: false },
    {
      source: "/pipeline/:path*",
      destination: "/assembly-lines/:path*",
      permanent: false,
    },
    {
      source: "/api/pipeline/:path*",
      destination: "/api/tasks/:path*",
      permanent: false,
    },
  ],
};

export default nextConfig;
