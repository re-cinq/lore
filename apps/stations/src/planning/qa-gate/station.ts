// Reads the answers the Q&A agent gave from the spec alone and the plan notes the notes check marked, and sends the spec writer back with only what failed until the rounds are spent; then the spec PR opens with the failures listed (see specs/7-feature-planning/spec.md).

import {
  defineStation,
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
} from "@re-cinq/lore-shared/feature-planning/spec-qa.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";

export type QaGateDeps = Pick<CoverageDeps, "visitsOf">;

export function qaGateHandle(deps: QaGateDeps): Handle {
  return async (brief, tools) => {
    try {
      return await judged(deps, brief.visitId, tools);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function judged(
  deps: QaGateDeps,
  visitId: string,
  tools: Tools,
): Promise<Report> {
  const [questions, notes] = await Promise.all([
    readJson(tools, "qa_answers"),
    readJson(tools, "plan_notes"),
  ]);
  const bag = specQaBagSchema.parse({ questions, notes });
  const spent = coverageRoundsSpent(await deps.visitsOf(visitId), "qa-gate");
  const verdict = qaGate(bag, spent);

  if (verdict.failures.length > 0) {
    await tools.produce("qa_failures", failureBrief(verdict.failures));
  }

  return { outcome: verdict.outcome };
}

async function readJson(tools: Tools, need: string): Promise<unknown> {
  return JSON.parse((await tools.read(need)).toString("utf8"));
}

export function startQaGateStation(): RunningStation {
  return defineStation("qa-gate", qaGateHandle(coverageDeps));
}
