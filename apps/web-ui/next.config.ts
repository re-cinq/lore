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
  // Two rounds of the same rename, and the same reason each time: links to these
  // paths live OUTSIDE this app — GitHub Issues, PR bodies and check-run summaries
  // posted before the rename, via libs/shared `linkifyMarkdown` and the Floor's
  // pr-check `detailsUrl`. Those cannot be rewritten, so the paths stay alive here.
  //
  // /pipeline → /assembly-runs (ADR-024 ubiquitous language), and
  // /assembly-lines → /assembly-runs (the blueprint/run split, FR6.41). The
  // /pipeline entries point at the CURRENT path rather than chaining through
  // /assembly-lines: a chain costs a round trip and breaks the day the middle hop
  // is deleted.
  //
  // `permanent: false` matches the /pipeline precedent and is deliberate — a 301
  // is cached by browsers indefinitely, so it cannot be taken back if a path has
  // to move again.
  redirects: async () => [
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
  ],
};

export default nextConfig;
