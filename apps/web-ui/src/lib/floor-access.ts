import { NextResponse } from "next/server";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { resolveFloorConfig, type FloorConfig } from "@/lib/floor-config";

/** The repo-access then Floor-env tail every Floor-backed route shares: a caller without access to the repo, and a deployment with no Floor configured, are refused the same way everywhere. */
export async function authorizeRepoFloorAccess(
  accessToken: string,
  repo: string,
): Promise<FloorConfig | NextResponse> {
  if (!(await userCanAccessRepo(accessToken, repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

  const floorConfig = resolveFloorConfig();

  if (!floorConfig) {
    return NextResponse.json(
      { error: "LORE_FLOOR_URL/LORE_INGEST_TOKEN not configured" },
      { status: 500 },
    );
  }

  return floorConfig;
}
