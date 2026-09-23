import "server-only";
import { NextResponse } from "next/server";
import { userCanAccessRepo } from "./user-repo-access";

/** What a run-page proxy needs of the source run: its repo, to authorize the caller against, and its definition. */
export interface SourceRun {
  repo: string;
  blueprintName: string;
}

/** The deployment is missing its lore-api credentials. A 500 rather than a 502: nothing upstream was asked, and the fix is on this side. */
export function unconfigured() {
  return NextResponse.json(
    { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
    { status: 500 },
  );
}

/** Resolves the source run, then authorizes against ITS repo (not form input): the client is trusted with ids, never with authz facts. */
export async function readAuthorizedSourceRun(
  apiUrl: string,
  headers: Record<string, string>,
  accessToken: string,
  runId: string,
): Promise<SourceRun | NextResponse> {
  const line = await readSourceRun(apiUrl, headers, runId);

  if (line instanceof Response) {
    return line;
  }

  if (!(await userCanAccessRepo(accessToken, line.repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

  return line;
}

/** The run being acted on. A 404 upstream is a 404 here; anything else is this route failing to reach lore-api. */
async function readSourceRun(
  apiUrl: string,
  headers: Record<string, string>,
  runId: string,
): Promise<SourceRun | NextResponse> {
  const runRes = await fetch(
    `${apiUrl}/api/assembly-runs/${encodeURIComponent(runId)}`,
    { signal: AbortSignal.timeout(30_000), headers },
  );

  if (!runRes.ok) {
    return NextResponse.json(
      { error: `assembly run not found (${runRes.status})` },
      { status: runRes.status === 404 ? 404 : 502 },
    );
  }
  const { line } = (await runRes.json()) as { line: SourceRun };

  return line;
}

/** A refusal from lore-api, passed through with its reason; only a reasonless answer degrades to 502. */
export async function upstreamRefusal(
  upstream: Response,
): Promise<NextResponse> {
  const body = (await upstream.json().catch(() => ({}))) as { error?: string };

  return NextResponse.json(
    { error: body.error ?? `lore-api answered ${upstream.status}` },
    { status: body.error ? upstream.status : 502 },
  );
}
