export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { sessionToken } from "@/lib/session-token";
import { authorizeRepoUpstreamAccess } from "@/lib/floor-access";
import { proxyJson } from "@/lib/floor-proxy";
import { serverError } from "@/lib/api-error";
import type { UpstreamConfig } from "@/lib/floor-config";

interface PullParams {
  owner: string;
  repo: string;
  number: string;
}

// Session-authed proxy to lore-api's /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason (specs/protected-branch-merge): the run page reads why a settled PR has not merged yet.
export async function GET(
  req: Request,
  { params }: { params: Promise<PullParams> },
) {
  const { owner, repo, number } = await params;

  try {
    return await proxyBlockedReason(`${owner}/${repo}`, number, req);
  } catch (err) {
    return serverError("pull-blocked-reason", err);
  }
}

async function proxyBlockedReason(
  fullRepo: string,
  number: string,
  req: Request,
) {
  const auth = await authorizeRepoAccess(fullRepo);

  if (auth instanceof NextResponse) {
    return auth;
  }

  return proxyJson(
    await fetch(
      `${auth.upstreamUrl}/api/repos/${fullRepo}/pulls/${encodeURIComponent(number)}/blocked-reason`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: req.signal,
      },
    ),
  );
}

async function authorizeRepoAccess(
  fullRepo: string,
): Promise<UpstreamConfig | NextResponse> {
  if (!(await sessionToken())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return authorizeRepoUpstreamAccess(fullRepo, "lore-api");
}
