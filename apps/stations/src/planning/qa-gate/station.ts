// Judges the spec the writer pushed: the answers the Q&A agent gave from the spec alone, the plan notes the notes check marked, and the spec's own checks against the branch and main. It sends the writer back with only what failed until the rounds are spent; then the spec PR opens with the failures listed (see specs/7-feature-planning/spec.md FR-17).

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
  failureBrief,
  qaGate,
  specQaBagSchema,
  type SpecQaBag,
} from "@re-cinq/lore-shared/feature-planning/spec-qa.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";
import { branchChecks } from "./branch-checks.js";

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
  const [bag, checks, spent] = await Promise.all([
    qaBagOf(tools),
    branchChecks(deps, brief, tools),
    deps
      .visitsOf(brief.visitId)
      .then((visits) => coverageRoundsSpent(visits, "qa-gate")),
  ]);
  const verdict = qaGate(bag, spent, checks?.gaps ?? 0);

  // The bag never drops a key: an empty file is how a round with no failures clears the last round's.
  await Promise.all([
    tools.produce("qa_failures", failureBrief(verdict.failures)),
    checks && tools.produce("plan_coverage", checks.brief),
  ]);

  return { outcome: verdict.outcome };
}

async function qaBagOf(tools: Tools): Promise<SpecQaBag> {
  const [questions, notes] = await Promise.all([
    readJson(tools, "qa_answers"),
    readJson(tools, "plan_notes"),
  ]);

  return specQaBagSchema.parse({ questions, notes });
}

async function readJson(tools: Tools, need: string): Promise<unknown> {
  return JSON.parse((await tools.read(need)).toString("utf8"));
}

export function startQaGateStation(): RunningStation {
  return defineStation("qa-gate", qaGateHandle(coverageDeps));
}
