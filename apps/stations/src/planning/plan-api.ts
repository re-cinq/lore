// The planning stations' one door to lore-api's plan routes under /api/plans: a request that is not answered 2xx fails the visit with what lore-api said.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { bearerJsonHeaders } from "@re-cinq/lore-shared/project/lib/http-auth.js";

const TIMEOUT_MS = 30_000;

export async function requestPlan(
  path: string,
  init: { method: "GET" | "POST"; body?: object },
): Promise<Response> {
  const res = await fetch(`${requiredApiUrl()}/api/plans/${path}`, {
    method: init.method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: bearerJsonHeaders(stationToken()),
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  enforceTrue(
    res.ok,
    Error,
    `${init.method} /api/plans/${path} failed: ${res.status}`,
  );

  return res;
}

// LORE_API_URL unset is a hard failure, not a silent skip: writing to the plan is these stations' whole job.
function requiredApiUrl(): string {
  const baseUrl = process.env.LORE_API_URL;

  enforceTrue(
    baseUrl,
    Error,
    "the planning stations require LORE_API_URL to write to a plan",
  );

  return baseUrl;
}

function stationToken(): string | undefined {
  return process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;
}
