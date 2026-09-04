/** Start one refinement round: parked node resolved BEFORE the round is appended (a refusal must not leave an orphan round), and appended BEFORE it's reported (so the report names a round that exists). */

import { enforceTrue, type ErrorType } from "../../lib/enforce.js";
import {
  composePlanningPrompt,
  composeRoundFeedback,
} from "../../feature-planning/planning-prompt.js";
import { resolveRoundBasis, type RoundBasis } from "./features-port.js";
import type { SectionAnswers } from "../../feature-planning/planning-prompt.js";
import type { ParkedAuthorNode } from "./planning-run.js";

export interface RefinementFeature {
  id: string;
  title: string;
  original_prompt: string;
  iterations: unknown[];
}

export interface RefinementInput {
  /** Null when the author submitted no sections; passed through as-is since the prompt composer distinguishes it from an empty answer set. */
  answers: SectionAnswers | null;
  /** The round the AUTHOR named, when this is a rewind rather than a next step. */
  rewoundTo?: number;
}

export interface RefinementRoundDeps {
  /** The errors the CALLER wants thrown — the sequence knows the fault, only the caller knows its status code (400/409), so an HTTP route can delegate ordering here. */
  invalidBasis: ErrorType;
  notParked(runId: string | null): ErrorType;
  parkedNode(featureId: string): Promise<ParkedAuthorNode>;
  appendIteration(
    featureId: string,
    answers: SectionAnswers | null,
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

/** The resolved (`ok: true`) shape of {@link RoundBasis} — what's left once `enforceTrue(basis.ok, ...)` has thrown on a rejected basis. */
type ResolvedRoundBasis = Extract<RoundBasis, { ok: true }>;

/** The prior round's iteration number, when the basis names one round. */
function basisIteration(basis: ResolvedRoundBasis): number | null {
  return basis.basis?.iteration ?? null;
}

/** Sent on EVERY round (null when no rewind): the resume MERGES into the line's args, so an omitted key would leave an earlier rewind still steering. */
function resumeFromIteration(
  rewoundTo: number | undefined,
  basis: ResolvedRoundBasis,
): number | null {
  return rewoundTo === undefined ? null : basisIteration(basis);
}

export async function startRefinementRound(
  feature: RefinementFeature,
  input: RefinementInput,
  deps: RefinementRoundDeps,
): Promise<RefinementRoundResult> {
  const basis = resolveRoundBasis(feature.iterations as never, input.rewoundTo);

  enforceTrue(basis.ok, deps.invalidBasis, basis.ok ? "" : basis.error);

  const priorGap = basis.basis?.gap_result ?? null;
  const description = composePlanningPrompt({
    title: feature.title,
    originalPrompt: feature.original_prompt,
    priorGap,
    answers: input.answers,
  });

  const { runId, parked } = await deps.parkedNode(feature.id);

  enforceTrue(
    parked,
    deps.notParked(runId),
    "no planning round is waiting on you — a refinement reports to the author node, and this feature's line is not parked there",
  );

  const row = await deps.appendIteration(
    feature.id,
    input.answers,
    basisIteration(basis),
  );

  await deps.report(parked, "changes_requested", {
    description,
    round_feedback: composeRoundFeedback({
      round: row.iteration,
      priorGap,
      answers: input.answers,
    }),
    iteration: row.iteration,
    resume_from_iteration: resumeFromIteration(input.rewoundTo, basis),
  });

  return { iteration: row.iteration, runId: parked.lineId };
}
