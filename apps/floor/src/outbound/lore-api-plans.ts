import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { PlanWriter } from "../domain/plan-writer.js";

const TIMEOUT_MS = 30_000;

/** lore-api's plan writes (ADR-047) with the Floor's service token; a refusal throws with lore-api's own problem detail. */
export function loreApiPlans(baseUrl: string, token: string): PlanWriter {
  const post = (path: string, body: object) =>
    postToPlans(baseUrl, token, path, body);

  return {
    applyOps: (planId, body) => post(`${planId}/agent-edits`, body),
    propose: (planId, body) => post(`${planId}/proposals`, body),
  };
}

async function postToPlans(
  baseUrl: string,
  token: string,
  path: string,
  body: object,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/plans/${path}`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const refusal = res.ok ? "" : await res.text();

  enforceTrue(
    res.ok,
    Error,
    `lore-api answered ${res.status} to ${path}: ${refusal}`,
  );
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}
