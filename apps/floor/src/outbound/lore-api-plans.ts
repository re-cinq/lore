import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { PlanWriter } from "../domain/plan-writer.js";

// A multi-megabyte plan moves in both directions, so the budget is a transfer's, not a JSON call's.
const TIMEOUT_MS = 120_000;

/** lore-api's plan file routes (ADR-047) with the Floor's service token; a refusal throws with lore-api's own problem detail. */
export function loreApiPlans(baseUrl: string, token: string): PlanWriter {
  const request = (path: string, init: RequestInit) =>
    requestPlans(baseUrl, token, path, init);

  return {
    markdownOf: async (planId) =>
      (await request(`${planId}/markdown`, { method: "GET" })).text(),
    submitFile: async (planId, body) => {
      await request(`${planId}/agent-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
  };
}

async function requestPlans(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(`${baseUrl}/api/plans/${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const refusal = res.ok ? "" : await res.text();

  enforceTrue(
    res.ok,
    Error,
    `lore-api answered ${res.status} to ${path}: ${refusal}`,
  );

  return res;
}
