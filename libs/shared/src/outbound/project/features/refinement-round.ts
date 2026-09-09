/** Start one refinement round: parked node resolved BEFORE the round is appended (a refusal must not leave an orphan round), and appended BEFORE it's reported (so the report names a round that exists). */

import { enforceTrue, type ErrorType } from "../../../lib/enforce.js";
import {
  composePlanningPrompt,
  composeRoundFeedback,
} from "../../../domain/feature-planning/planning-prompt.js";
import { resolveRoundBasis, type RoundBasis } from "./features-port.js";
import type { SectionAnswers } from "../../../domain/feature-planning/planning-prompt.js";
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
  unparked(runId: string | null): ErrorType;
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

/** The node this refinement answers. A refinement is a REPLY, not a fresh start: it only makes sense while the line is parked at its author node waiting for exactly this, so a feature that has moved on is refused rather than silently starting a round nobody is listening for. */
async function awaitingNode(deps: RefinementRoundDeps, featureId: string) {
  const { runId, parked } = await deps.parkedNode(featureId);

  enforceTrue(
    parked,
    deps.unparked(runId),
    "no planning round is waiting on you — a refinement reports to the author node, and this feature's line is not parked there",
  );

  return parked;
}

/** The prompt for this round. It carries the ORIGINAL ask alongside the prior round's gaps and the answers to them — a refinement that saw only the answers would drift further from what was asked with every round. */
function planningPrompt(
  feature: RefinementFeature,
  priorGap: Parameters<typeof composePlanningPrompt>[0]["priorGap"],
  answers: RefinementInput["answers"],
): string {
  return composePlanningPrompt({
    title: feature.title,
    originalPrompt: feature.original_prompt,
    priorGap,
    answers,
  });
}

/** The basis this round builds on. A rejected basis is the CALLER's error, thrown before anything is appended. */
function requireBasis(
  feature: RefinementFeature,
  rewoundTo: number | undefined,
  invalidBasis: ErrorType,
): ResolvedRoundBasis {
  const basis = resolveRoundBasis(feature.iterations as never, rewoundTo);

  enforceTrue(basis.ok, invalidBasis, basis.ok ? "" : basis.error);

  return basis;
}

/** Everything decided BEFORE the round is appended, so a rejected basis or an unparked line leaves no orphan round behind. */
async function prepareRound(
  feature: RefinementFeature,
  input: RefinementInput,
  deps: RefinementRoundDeps,
) {
  const basis = requireBasis(feature, input.rewoundTo, deps.invalidBasis);
  const priorGap = basis.basis?.gap_result ?? null;

  return {
    basis,
    priorGap,
    description: planningPrompt(feature, priorGap, input.answers),
    parked: await awaitingNode(deps, feature.id),
  };
}

type PreparedRound = Awaited<ReturnType<typeof prepareRound>>;

/** Reports the appended round to the parked author node — the line resumes from there. */
async function reportRound(
  deps: RefinementRoundDeps,
  prepared: PreparedRound,
  iteration: number,
  input: RefinementInput,
): Promise<void> {
  await deps.report(prepared.parked, "changes_requested", {
    description: prepared.description,
    round_feedback: composeRoundFeedback({
      round: iteration,
      priorGap: prepared.priorGap,
      answers: input.answers,
    }),
    iteration,
    resume_from_iteration: resumeFromIteration(input.rewoundTo, prepared.basis),
  });
}

export async function startRefinementRound(
  feature: RefinementFeature,
  input: RefinementInput,
  deps: RefinementRoundDeps,
): Promise<RefinementRoundResult> {
  const prepared = await prepareRound(feature, input, deps);
  const row = await deps.appendIteration(
    feature.id,
    input.answers,
    basisIteration(prepared.basis),
  );

  await reportRound(deps, prepared, row.iteration, input);

  return { iteration: row.iteration, runId: prepared.parked.lineId };
}
