import { NextResponse } from "next/server";
import { fetchAssemblyRun, type AssemblyRun } from "@/lib/assembly-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { resolveFloorConfig } from "@/lib/floor-config";

export interface AssemblyRunAuth {
  run: AssemblyRun;
  floorUrl: string;
  token: string;
}

/** Type guard narrowing an {@link authorizeAssemblyRunAccess} result to the error response. */
export function isAssemblyRunAuthError(
  result: AssemblyRunAuth | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/** Session → run → repo-access → Floor-env ladder shared by every run proxy route (events/turns/stream/node-logs). */
export async function authorizeAssemblyRunAccess(
  id: string,
): Promise<AssemblyRunAuth | NextResponse> {
  const accessToken = await resolveSessionAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await fetchAssemblyRun(id);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (!(await userCanAccessRepo(accessToken, run.repo))) {
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

  return { run, ...floorConfig };
}
