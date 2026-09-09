export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { assemblyRunProxyRoute } from "@/lib/assembly-run-auth";
import { proxyJson } from "@/lib/floor-proxy";

// Session-authed proxy to lore-api's per-PR changed files, scoped by run (specs/assembly-line-run-viz FR8.4): the browser names a run, never a repo and PR number of its own choosing.
export const GET = assemblyRunProxyRoute(
  "assembly-run-pull-files",
  async ({ run, req, upstreamUrl, token }) => {
    if (run.prNumber === null) {
      return NextResponse.json(
        { error: "This run has no pull request" },
        { status: 404 },
      );
    }

    return proxyJson(
      await fetch(
        `${upstreamUrl}/api/repos/${run.repo}/pulls/${run.prNumber}/files`,
        { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
      ),
    );
  },
  "lore-api",
);
