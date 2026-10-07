// Every analyze pass on the feature-planning line settles here before the author waits again: lore-api is told how the pass ended and answers the section its person asked about, or says why it could not. Which section that is lives in lore-api, not in the run's bag — a Refine starts the node by hand and a start by hand carries no items (see specs/7-feature-planning FR-18).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { requestPlan } from "../plan-api.js";

interface AnalyzeVisit {
  nodeId: string;
  report: { outcome: string } | null;
}

export interface PlanPassEndDeps {
  /** The visit's own run, for finding its sibling `analyze` visits. */
  runOf(visitId: string): Promise<string | null>;
  visitsOf(runId: string): Promise<AnalyzeVisit[]>;
  /** How the pass ended; lore-api holds the ask and decides what to tell the section. */
  passEnded(input: {
    planId: string;
    outcome: string;
    reason?: string;
  }): Promise<void>;
}

const SUCCESS: Report = { outcome: "success" };

export function planPassEndHandle(deps: PlanPassEndDeps): Handle {
  return async (brief) => {
    const outcome = await analyzeOutcomeOf(deps, brief.visitId);

    return settled(() =>
      deps.passEnded({
        planId: brief.needs.plan_id,
        outcome: outcome ?? "missing",
        ...(outcome === "success" ? {} : { reason: stopped(outcome) }),
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
  passEnded: async ({ planId, ...pass }) => {
    await requestPlan(`${planId}/refine-settled`, {
      method: "POST",
      body: pass,
    });
  },
};

export function startPlanPassEndStation(): RunningStation {
  return defineStation("plan-pass-end", planPassEndHandle(productionDeps));
}
