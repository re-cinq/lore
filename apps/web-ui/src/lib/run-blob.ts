// A blob the run page's Needs card links to (run-viz FR4.4m), read through lore-api on the same ladder every run proxy uses: a signed-in caller, a run that exists, and access to that run's repo.
import type { components } from "@/lib/api/schema";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";

export type RunBlob = components["schemas"]["RunBlob"];

export type RunBlobResult =
  | { status: "ok"; blob: RunBlob }
  | { status: "denied" }
  | { status: "not-found" }
  | { status: "unavailable" };

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
// lore-api calls a malformed hash 400 and a blob the run does not reference 404; to the reader both are a blob this run does not have.
const ABSENT_BLOB = new Set([HTTP_BAD_REQUEST, HTTP_NOT_FOUND]);
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchRunBlob(
  runId: string,
  hash: string,
): Promise<RunBlobResult> {
  const access = await authorizeAssemblyRunAccess(runId);

  if (isAssemblyRunAuthError(access)) {
    return {
      status: access.status === HTTP_NOT_FOUND ? "not-found" : "denied",
    };
  }
  const response = await readBlob(access, runId, hash);

  return response.ok
    ? { status: "ok", blob: (await response.json()) as RunBlob }
    : {
        status: ABSENT_BLOB.has(response.status) ? "not-found" : "unavailable",
      };
}

function readBlob(
  { upstreamUrl, token }: { upstreamUrl: string; token: string },
  runId: string,
  hash: string,
): Promise<Response> {
  return fetch(
    `${upstreamUrl}/api/assembly-runs/${encodeURIComponent(runId)}/blobs/${encodeURIComponent(hash)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
}
