// Every analyze pass on the feature-planning line settles here before the author waits again: a draft has nothing to settle, a dead Refine pass gets its `refine-failed` posted so its person is told (see specs/external-floor/spec.md FR8.5).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { bearerJsonHeaders } from "@re-cinq/lore-shared/project/lib/http-auth.js";

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
}

const SUCCESS: Report = { outcome: "success" };

export function planPassEndHandle(deps: PlanPassEndDeps): Handle {
  return async (brief) => {
    const refine = refineOf(brief.needs.refine);

    if (!refine) {
      return SUCCESS;
    }
    const outcome = await analyzeOutcomeOf(deps, brief.visitId);

    return outcome === "success"
      ? SUCCESS
      : reportRefineFailed(deps, brief.needs.plan_id, refine.slot, outcome);
  };
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

async function reportRefineFailed(
  deps: PlanPassEndDeps,
  planId: string,
  slot: string,
  outcome: string | undefined,
): Promise<Report> {
  try {
    await deps.refineFailed({
      planId,
      slot,
      reason: `the planning agent stopped with outcome ${outcome ?? "missing"} before it answered`,
    });

    return SUCCESS;
  } catch (err) {
    return { outcome: "failed", error: (err as Error).message };
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
  refineFailed: postRefineFailed,
};

interface RefineFailedInput {
  planId: string;
  slot: string;
  reason: string;
}

async function postRefineFailed(input: RefineFailedInput): Promise<void> {
  const baseUrl = requiredApiUrl();
  const res = await fetch(
    `${baseUrl}/api/plans/${input.planId}/refine-failed`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: bearerJsonHeaders(stationToken()),
      body: JSON.stringify({ slot: input.slot, reason: input.reason }),
    },
  );

  enforceTrue(
    res.ok,
    Error,
    `refine-failed post for plan ${input.planId} failed: ${res.status}`,
  );
}

// LORE_API_URL unset is a hard failure, not a silent skip: posting this one call is this station's whole job.
function requiredApiUrl(): string {
  const baseUrl = process.env.LORE_API_URL;

  enforceTrue(
    baseUrl,
    Error,
    "plan-pass-end requires LORE_API_URL to report a refine failure",
  );

  return baseUrl;
}

function stationToken(): string | undefined {
  return process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;
}

export function startPlanPassEndStation(): RunningStation {
  return defineStation("plan-pass-end", planPassEndHandle(productionDeps));
}
