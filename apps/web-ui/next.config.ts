import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
