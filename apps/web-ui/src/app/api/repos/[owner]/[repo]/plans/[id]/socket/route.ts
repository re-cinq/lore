export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { openPlanSocket } from "@/app/repos/[owner]/[repo]/plans/[id]/plan-access";

const GITHUB_NAME = /^[\w.-]+$/;
const PLAN_ID = /^[\w-]+$/;

// The plan editor asks here for every (re)connect's token. A route keeps its URL across deployments, where a server action's id is the build's: a tab open over a deploy asked for a token by an id the new build did not have, and read the failure as "no access".
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; repo: string; id: string }> },
) {
  const { owner, repo, id } = await params;

  // The access check reads owner/repo while the mint is addressed by all three, so a segment that is not a plain name could point the mint at another repo's plan.
  if (![owner, repo].every(isGitHubName) || !PLAN_ID.test(id)) {
    return NextResponse.json(
      { error: "Not a plan of a repository." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const socket = await openPlanSocket(`${owner}/${repo}`, id);

  return NextResponse.json(socket, {
    status: "error" in socket ? 403 : 200,
    headers: { "cache-control": "no-store" },
  });
}

function isGitHubName(segment: string): boolean {
  return GITHUB_NAME.test(segment) && segment !== "." && segment !== "..";
}
