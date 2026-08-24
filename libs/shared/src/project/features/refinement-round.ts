/**
 * Start one refinement round on a feature's planning line.
 *
 * The sequence, not the HTTP around it. Two orderings here are load-bearing and
 * were only a comment in a route handler before:
 *
 *  - the parked node is resolved BEFORE the round row is appended, because a
 *    refusal that had already appended one leaves a round nothing will ever run;
 *  - the round is appended BEFORE it is reported, so the report names a round
 *    that exists.
 *
 * This lifecycle has produced five silent-channel defects, which is reason
 * enough for its ordering to be asserted rather than described.
 */

import { enforceTrue } from "../../lib/enforce.js";
import {
  composePlanningPrompt,
  composeRoundFeedback,
} from "../../feature-planning/planning-prompt.js";
import { resolveRoundBasis } from "./features-port.js";
import type { ParkedAuthorNode } from "./planning-run.js";

export interface RefinementFeature {
  id: string;
  title: string;
  original_prompt: string;
  iterations: unknown[];
}

export interface RefinementInput {
  answers: Record<string, unknown>;
  /** The round the AUTHOR named, when this is a rewind rather than a next step. */
  rewoundTo?: number;
}

export interface RefinementRoundDeps {
  parkedNode(featureId: string): Promise<ParkedAuthorNode>;
  appendIteration(
    featureId: string,
    answers: Record<string, unknown>,
    basisIteration: number | null,
  ): Promise<{ iteration: number }>;
  report(
    target: { lineId: string; nodeId: string; iteration: number },
    outcome: "changes_requested",
    args: Record<string, unknown>,
  ): Promise<void>;
}

export interface RefinementRoundResult {
  iteration: number;
  runId: string;
}

export async function startRefinementRound(
  feature: RefinementFeature,
  input: RefinementInput,
  deps: RefinementRoundDeps,
): Promise<RefinementRoundResult> {
  const basis = resolveRoundBasis(feature.iterations as never, input.rewoundTo);

  enforceTrue(basis.ok, Error, basis.ok ? "" : basis.error);

  const priorGap = basis.basis?.gap_result ?? null;
  const description = composePlanningPrompt({
    title: feature.title,
    originalPrompt: feature.original_prompt,
    priorGap,
    answers: input.answers as never,
  });

  const { parked } = await deps.parkedNode(feature.id);

  enforceTrue(
    parked,
    Error,
    "no planning round is waiting on you — a refinement reports to the author node, and this feature's line is not parked there",
  );

  const row = await deps.appendIteration(
    feature.id,
    input.answers,
    basis.basis?.iteration ?? null,
  );

  await deps.report(parked, "changes_requested", {
    description,
    round_feedback: composeRoundFeedback({
      round: row.iteration,
      priorGap,
      answers: input.answers as never,
    }),
    iteration: row.iteration,
    // Sent on EVERY round (null when there was no rewind): the resume MERGES
    // into the line's args, so an omitted key would leave an earlier rewind
    // still steering.
    resume_from_iteration:
      input.rewoundTo === undefined ? null : (basis.basis?.iteration ?? null),
  });

  return { iteration: row.iteration, runId: parked.lineId };
}
