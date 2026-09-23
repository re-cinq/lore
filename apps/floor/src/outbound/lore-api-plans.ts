import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { PlanOpener, PlanWriter } from "../domain/plan-writer.js";

// A multi-megabyte plan moves in both directions, so the budget is a transfer's, not a JSON call's.
const TIMEOUT_MS = 120_000;

/** lore-api's plan file routes (ADR-047) with the Floor's service token; a refusal throws with lore-api's own problem detail. */
export function loreApiPlans(baseUrl: string, token: string): PlanWriter {
  const request = (path: string, init: RequestInit) =>
    requestLoreApi(baseUrl, token, `/api/plans/${path}`, init);
  const post = async (path: string, body: unknown) => {
    await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  return {
    markdownOf: async (planId) =>
      (await request(`${planId}/markdown`, { method: "GET" })).text(),
    submitFile: (planId, body) => post(`${planId}/agent-file`, body),
    failRefine: (planId, refine) => post(`${planId}/refine-failed`, refine),
  };
}

/** lore-api's `author-waiting` route: it reopens an approved plan whose line waits on its author, and leaves any other plan as it is. */
export function loreApiPlanOpener(baseUrl: string, token: string): PlanOpener {
  return {
    openForAuthor: async (repo, planId) => {
      await requestLoreApi(
        baseUrl,
        token,
        `/api/repos/${repo}/plans/${planId}/author-waiting`,
        { method: "POST" },
      );
    },
  };
}

async function requestLoreApi(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
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
