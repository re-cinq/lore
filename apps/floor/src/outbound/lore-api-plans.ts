import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  PlanFinding,
  PlanOpener,
  PlanSection,
  PlanWriter,
} from "../domain/plan-writer.js";

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
  const del = async (path: string) => {
    await request(path, { method: "DELETE" });
  };

  return {
    markdownOf: async (planId) =>
      (await request(`${planId}/markdown`, { method: "GET" })).text(),
    submitFile: (planId, body) => post(`${planId}/agent-file`, body),
    failRefine: (planId, refine) => post(`${planId}/refine-failed`, refine),
    finishRefine: (planId, done) => post(`${planId}/refine-done`, done),
    // planning-sync's own route: `{actor, ops, base?}`; the Floor never sends `base`, so the ops land on whatever the plan is by then.
    addQuestions: (planId, edits) => post(`${planId}/agent-edits`, edits),
    openPresence: (planId, user) => post(`${planId}/agent-presence`, { user }),
    closePresence: (planId) => del(`${planId}/agent-presence`),
    ...planReads(request),
  };
}

/** lore-api's plan routes for a parked planning line: `author-waiting` reopens an approved plan whose line waits on its author, `reopen` reopens one the spec review sent questions to; both leave any other plan as it is. */
export function loreApiPlanOpener(baseUrl: string, token: string): PlanOpener {
  const post = async (path: string, body?: unknown) => {
    await requestLoreApi(baseUrl, token, `/api/repos/${path}`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  };

  return {
    openForAuthor: (repo, planId) =>
      post(`${repo}/plans/${planId}/author-waiting`),
    reopenForReview: (repo, planId, actor) =>
      post(`${repo}/plans/${planId}/reopen`, { reopenedBy: actor }),
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

// planning-sync's plan projection (`GET /api/plans/{id}`), read only as far as its sections and their finding blocks.
const planProjectionSchema = z.object({
  json: z.object({
    sections: z.array(
      z.object({
        slot: z.string(),
        title: z.string().default(""),
        blocks: z.array(
          z.object({
            type: z.string(),
            props: z.record(z.string(), z.unknown()).default({}),
          }),
        ),
      }),
    ),
  }),
});

const findingPropsSchema = z.object({
  findingId: z.string(),
  resolved: z.unknown().transform((value) => value === true),
});

type PlanRequest = (path: string, init: RequestInit) => Promise<Response>;

/** The reads of planning-sync's plan projection (`GET /api/plans/{id}`): its sections, and its finding blocks. */
function planReads(
  request: PlanRequest,
): Pick<PlanWriter, "findingsOf" | "sectionsOf"> {
  const projection = (planId: string): Promise<unknown> =>
    request(planId, { method: "GET" }).then((res) => res.json());

  return {
    findingsOf: async (planId) => findingsIn(await projection(planId)),
    sectionsOf: async (planId) => sectionsIn(await projection(planId)),
  };
}

/** The sections of a plan projection, in the plan's order. */
function sectionsIn(projection: unknown): PlanSection[] {
  const { sections } = planProjectionSchema.parse(projection).json;

  return sections.map(({ slot, title }) => ({ slot, title }));
}

/** The finding blocks of a plan projection, section by section. */
function findingsIn(projection: unknown): PlanFinding[] {
  const { sections } = planProjectionSchema.parse(projection).json;

  return sections.flatMap(({ slot, blocks }) =>
    blocks
      .filter((block) => block.type === "finding")
      .map((block) => ({ slot, ...findingPropsSchema.parse(block.props) })),
  );
}
