// Judges the spec the writer pushed: the answers the Q&A agent gave from the spec alone to the questions frozen from the plan, and the spec's own checks against the branch and main. A failure is counted only after a second pod, shown just the failed questions, has answered them too. The writer is sent back with only what both pods failed, until the rounds are spent or the gaps stop falling; then the spec PR opens with the failures listed (see specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { coverageRoundsSpent } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import {
  advisoryBrief,
  failureBrief,
  qaGate,
  redoRequest,
  specAnswerSchema,
  specQaBagSchema,
  withRecheck,
  type GateOptions,
  type QaVerdict,
  type SpecQaBag,
} from "@re-cinq/lore-shared/feature-planning/spec-qa.js";
import {
  coverageDeps,
  type CoverageDeps,
  type RunVisit,
} from "../coverage-deps.js";
import {
  branchChecks,
  specsOfBranch,
  type BranchChecks,
  type SpecFile,
} from "./branch-checks.js";
import { optionalNeedText } from "../../domain/need-text.js";

export function qaGateHandle(deps: CoverageDeps): Handle {
  return async (brief, tools) => {
    try {
      return await judged(deps, brief, tools);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function judged(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<Report> {
  const round = await readRound(deps, brief, tools);
  const verdict = qaGate(await answersOf(round, tools), round.options);

  if (needsRecheck(verdict) && !round.afterRecheck) {
    return askForRecheck(tools, verdict);
  }
  await deliver(tools, { ...round, verdict, iteration: brief.iteration });

  return { outcome: verdict.outcome };
}

interface Round {
  bag: SpecQaBag;
  checks: BranchChecks | null;
  history: number[];
  options: GateOptions;
  /** This visit follows the second pod's answers. */
  afterRecheck: boolean;
}

async function readRound(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<Round> {
  const specs = await specsOfBranch(deps, brief, tools);
  const visits = await deps.visitsOf(brief.visitId);
  const [bag, checks, history] = await Promise.all([
    qaBagOf(tools),
    branchChecks(deps, brief, tools, specs ?? []),
    historyOf(brief, tools),
  ]);

  return {
    bag,
    checks,
    history: history ?? [],
    afterRecheck: visits.at(-2)?.nodeId === "qa-recheck",
    options: optionsOf({ checks, specs, visits, history }),
  };
}

interface Read {
  checks: BranchChecks | null;
  specs: SpecFile[] | null;
  visits: RunVisit[];
  history: number[] | null;
}

function optionsOf({ checks, specs, visits, history }: Read): GateOptions {
  return {
    roundsSpent: coverageRoundsSpent(visits, "qa-gate"),
    branchGaps: checks?.gaps ?? 0,
    specTexts: specs && specs.map((spec) => spec.text),
    previousGaps: history?.at(-1) ?? null,
  };
}

/** The first pod's answers, or the two pods' merged once the second has answered. */
async function answersOf(round: Round, tools: Tools): Promise<SpecQaBag> {
  return round.afterRecheck
    ? withRecheck(round.bag, await recheckAnswers(tools))
    : round.bag;
}

function needsRecheck(verdict: QaVerdict): boolean {
  return verdict.outcome === "changes_requested" && verdict.failures.length > 0;
}

/** Only the questions that failed, without the answers they expect, for a pod that has not seen the first answers. */
async function askForRecheck(
  tools: Tools,
  verdict: QaVerdict,
): Promise<Report> {
  const blind = verdict.failures.map(({ id, text }) => ({
    id,
    question: text,
  }));

  await tools.produce("qa_recheck_blind", JSON.stringify(blind));

  return { outcome: "recheck" };
}

interface Delivery {
  verdict: QaVerdict;
  /** The gate visit's iteration numbers its redo request: it only grows within a run, where the rounds spent start again after a person acts, so a request left from before a restart is never taken for a new one. */
  iteration: number;
  checks: BranchChecks | null;
  history: number[];
  options: GateOptions;
}

/** The bag never drops a key: an empty `qa_failures` is how a round with no failures clears the last round's. */
async function deliver(
  tools: Tools,
  { verdict, checks, history, options, iteration }: Delivery,
): Promise<void> {
  const gaps = verdict.failures.length + (options.branchGaps ?? 0);
  const redo = redoRequest(
    verdict.failures,
    options.branchGaps ?? 0,
    iteration,
  );

  await Promise.all([
    tools.produce("qa_failures", failureBrief(verdict.failures)),
    tools.produce("qa_advisory", advisoryBrief(verdict.advisory)),
    tools.produce("qa_history", JSON.stringify([...history, gaps])),
    checks && tools.produce("plan_coverage", checks.brief),
    verdict.outcome === "changes_requested" &&
      tools.produce("redo_sections", JSON.stringify(redo)),
  ]);
}

async function recheckAnswers(tools: Tools) {
  return specAnswerSchema
    .array()
    .parse(await readJson(tools, "qa_recheck_answers"));
}

async function qaBagOf(tools: Tools): Promise<SpecQaBag> {
  const [questions, answers] = await Promise.all([
    readJson(tools, "qa_questions"),
    readJson(tools, "qa_answers"),
  ]);

  return specQaBagSchema.parse({ questions, answers });
}

/** The failures each earlier round counted; none before the gate's first round. */
async function historyOf(brief: Brief, tools: Tools): Promise<number[] | null> {
  const text = await optionalNeedText(brief.needs, tools, "qa_history");

  return text ? (JSON.parse(text) as number[]) : null;
}

async function readJson<T = unknown>(
  tools: Tools,
  need: string,
): Promise<T | null> {
  const text = (await tools.read(need)).toString("utf8");

  return text === "" ? null : (JSON.parse(text) as T);
}

export function startQaGateStation(): RunningStation {
  return defineStation("qa-gate", qaGateHandle(coverageDeps));
}
