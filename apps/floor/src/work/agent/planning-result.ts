// Delivers the planning agent's result.json to the plan it drafts (ADR-047): the pod carries no API token, so the Floor posts its artifact to lore-api — a draft as agent edits into the live plan, a Refine as a proposal for one section.

import type { AgentFileEvent } from "./agent-events.js";
import type {
  AgentEditsBody,
  PlanWriter,
  ProposalBody,
} from "../../domain/plan-writer.js";

export type { PlanWriter } from "../../domain/plan-writer.js";

/** The event name the feature-planning recipe declares in `output.watch`; must match the recipe since the Floor routes on it. */
export const PLANNING_RESULT_EVENT = "planning.result";

/** Who the plan's people see writing. */
export const PLANNING_ACTOR = "planning-agent";

export interface PlanningResultDeps {
  /** The plan the task's open planning run works on, when it names one. */
  planOf(taskId: string): Promise<string | undefined>;
  plans: PlanWriter;
}

/** What the DELIVERY did, never the round's verdict; `failed` = the agent's artifact could not be written, `skipped` = not this handler's event. */
export type PlanningDelivery =
  | { outcome: "ready" }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; error: string };

type Parsed =
  | { kind: "ops"; body: AgentEditsBody }
  | { kind: "proposal"; body: ProposalBody }
  | { kind: "failed"; error: string };

/** Write one planning artifact into its plan; skips every other event the sink carries. */
export async function deliverPlanningResult(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<PlanningDelivery> {
  if (fileEvent.event !== PLANNING_RESULT_EVENT) {
    return { outcome: "skipped", error: "not a planning result" };
  }
  const planId = await deps.planOf(fileEvent.taskId);

  if (!planId) {
    return { outcome: "skipped", error: "the run names no plan" };
  }

  return writeResult(planId, parseResult(fileEvent), deps.plans);
}

async function writeResult(
  planId: string,
  parsed: Parsed,
  plans: PlanWriter,
): Promise<PlanningDelivery> {
  if (parsed.kind === "failed") {
    return { outcome: "failed", error: parsed.error };
  }
  await (parsed.kind === "ops"
    ? plans.applyOps(planId, parsed.body)
    : plans.propose(planId, parsed.body));

  return { outcome: "ready" };
}

// lore-api validates the ops themselves; the Floor only tells a draft from a Refine's answer.
function parseResult(fileEvent: AgentFileEvent): Parsed {
  if (fileEvent.reason) {
    return {
      kind: "failed",
      error: `the agent produced no result.json (${fileEvent.reason})`,
    };
  }
  const result = parseJson(fileEvent.content);

  return "error" in result
    ? { kind: "failed", ...result }
    : shapeOf(result.value);
}

function shapeOf(value: unknown): Parsed {
  const result = (value ?? {}) as Partial<ProposalBody>;

  if (!Array.isArray(result.ops)) {
    return {
      kind: "failed",
      error: "result.json holds neither ops nor a section proposal",
    };
  }
  const ops = { actor: PLANNING_ACTOR, ops: result.ops };

  return typeof result.slot === "string" && typeof result.baseHash === "string"
    ? { kind: "proposal", body: proposalOf(ops, result) }
    : { kind: "ops", body: ops };
}

function proposalOf(
  ops: AgentEditsBody,
  result: Partial<ProposalBody>,
): ProposalBody {
  return {
    ...ops,
    slot: String(result.slot),
    baseHash: String(result.baseHash),
    uses: result.uses,
  };
}

function parseJson(
  content: string | null,
): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(content ?? "") };
  } catch (err) {
    return {
      error: `result.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Deliver every planning artifact in one sink batch; never throws, since a delivery failure must not 500 the telemetry ingest that also carries unrelated cost/run-viz rows. Returns how many it wrote. */
export async function deliverPlanningResults(
  fileEvents: readonly AgentFileEvent[],
  deps: PlanningResultDeps,
): Promise<number> {
  let delivered = 0;

  for (const fileEvent of fileEvents) {
    delivered += await deliverAndReport(fileEvent, deps);
  }

  return delivered;
}

async function deliverAndReport(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<number> {
  try {
    const result = await deliverPlanningResult(fileEvent, deps);

    if (result.outcome === "failed") {
      console.warn(
        `[planning-result] task ${fileEvent.taskId}: ${result.error}`,
      );
    }

    return result.outcome === "ready" ? 1 : 0;
  } catch (err) {
    console.error(
      `[planning-result] task ${fileEvent.taskId}: ${(err as Error).message}`,
    );

    return 0;
  }
}
