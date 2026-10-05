// Every analyze pass on the feature-planning line settles here before the author waits again: a draft has nothing to settle, a Refine pass that succeeded is marked done on the section it was asked for, and a dead one gets its `refine-failed` posted, so its person is told either way (see specs/external-floor/spec.md FR8.5).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { requestPlan } from "../plan-api.js";

interface RefineRequest {
  slot: string;
  baseHash: string;
  uses?: unknown;
}

interface AnalyzeVisit {
  nodeId: string;
  report: { outcome: string } | null;
}

export interface PlanPassEndDeps {
  /** The visit's own run, for finding its sibling `analyze` visits. */
  runOf(visitId: string): Promise<string | null>;
  visitsOf(runId: string): Promise<AnalyzeVisit[]>;
  refineFailed(input: {
    planId: string;
    slot: string;
    reason: string;
  }): Promise<void>;
  /** The section's ask is answered: without it the section keeps saying the agent is refining it. */
  refineDone(input: {
    planId: string;
    slot: string;
    uses: unknown;
  }): Promise<void>;
}

const SUCCESS: Report = { outcome: "success" };

export function planPassEndHandle(deps: PlanPassEndDeps): Handle {
  return async (brief) => {
    const refine = refineOf(brief.needs.refine);

    if (!refine) {
      return SUCCESS;
    }
    const outcome = await analyzeOutcomeOf(deps, brief.visitId);

    const planId = brief.needs.plan_id;

    return settled(() =>
      outcome === "success"
        ? deps.refineDone({ planId, slot: refine.slot, uses: usesOf(refine) })
        : deps.refineFailed({
            planId,
            slot: refine.slot,
            reason: stopped(outcome),
          }),
    );
  };
}

// A post that will not go through fails the node with what lore-api said: the person's section would otherwise be left with no answer and nothing to show why.
async function settled(post: () => Promise<void>): Promise<Report> {
  try {
    await post();

    return SUCCESS;
  } catch (err) {
    return { outcome: "failed", error: (err as Error).message };
  }
}

function stopped(outcome: string | undefined): string {
  return `the planning agent stopped with outcome ${outcome ?? "missing"} before it answered`;
}

// What the Refine built on, as its person settled it; an ask that named none used nothing.
function usesOf(refine: RefineRequest): unknown {
  return refine.uses ?? { questions: [], comments: [] };
}

/** The Refine this pass answered, or null for a draft. A value that will not parse, or names no slot, reads as a draft: there is no section to tell, and failing the node over it would say nothing to anybody. */
function refineOf(raw: string | undefined): RefineRequest | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RefineRequest>;

    return typeof parsed.slot === "string" ? (parsed as RefineRequest) : null;
  } catch {
    return null;
  }
}

/** The outcome the LATEST `analyze` visit of this same run reported — there may be more than one across earlier iterations, so only the last one speaks for this pass. */
async function analyzeOutcomeOf(
  deps: PlanPassEndDeps,
  visitId: string,
): Promise<string | undefined> {
  const runId = await deps.runOf(visitId);

  if (!runId) {
    return undefined;
  }
  const analyzeVisits = (await deps.visitsOf(runId)).filter(
    (visit) => visit.nodeId === "analyze",
  );
  const last = analyzeVisits.at(-1);

  return last?.report?.outcome;
}

const productionDeps: PlanPassEndDeps = {
  runOf: async (visitId) =>
    (await floorClient().stationRuns.get(visitId))?.runId ?? null,
  visitsOf: (runId) => floorClient().stationRuns.list({ run: runId }),
  refineFailed: ({ planId, ...failed }) =>
    postToPlan(planId, "refine-failed", failed),
  refineDone: ({ planId, ...done }) => postToPlan(planId, "refine-done", done),
};

async function postToPlan(
  planId: string,
  verb: "refine-failed" | "refine-done",
  body: object,
): Promise<void> {
  await requestPlan(`${planId}/${verb}`, { method: "POST", body });
}

export function startPlanPassEndStation(): RunningStation {
  return defineStation("plan-pass-end", planPassEndHandle(productionDeps));
}
