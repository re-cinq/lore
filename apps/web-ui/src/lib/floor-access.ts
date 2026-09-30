import { NextResponse } from "next/server";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import {
  resolveUpstreamConfig,
  type RunUpstream,
  type UpstreamConfig,
} from "@/lib/floor-config";

/** The repo-access then upstream-env tail every proxied route shares: a caller without access to the repo, and a deployment with the upstream unconfigured, are refused the same way everywhere. */
export async function authorizeRepoUpstreamAccess(
  accessToken: string,
  repo: string,
  upstream: RunUpstream,
): Promise<UpstreamConfig | NextResponse> {
  if (!(await userCanAccessRepo(accessToken, repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

  const config = resolveUpstreamConfig(upstream);

  if (!config) {
    return NextResponse.json(
      { error: `${upstream} URL/token not configured` },
      { status: 500 },
    );
  }

  return config;
}
