// After the spec writer pushes, counts which blocks of the approved plan no spec statement cites, and sends the writer back with only those until the coverage round budget is spent; then the spec PR opens with the gaps listed for its reviewer (see specs/external-floor/spec.md FR8.22).

import {
  defineStation,
  type Brief,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import {
  COVERAGE_ROUNDS,
  coverageBrief,
  coverageRoundsSpent,
  planCoverage,
  type CitablePlan,
  type PlanCoverage,
} from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import { specPathsOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface RunVisit {
  nodeId: string;
  report: { outcome: string } | null;
}

export interface SpecCoverageDeps {
  /** A spec file as it stands on the branch the writer pushed; null when the branch has no such file. */
  readSpec(repo: string, path: string, ref: string): Promise<string | null>;
  /** Every visit of the run this visit belongs to, oldest first. */
  visitsOf(visitId: string): Promise<RunVisit[]>;
}

const SUCCESS: Report = { outcome: "success" };

export function specCoverageHandle(deps: SpecCoverageDeps): Handle {
  return async (brief, tools) => {
    // A deployment that names no web UI hands the run no blocks to cite, so there is nothing to count.
    if (!brief.needs.plan_blocks) {
      return SUCCESS;
    }

    try {
      const coverage = await coverageOnBranch(deps, brief, tools);

      await tools.produce("plan_coverage", coverageBrief(coverage));

      return await verdict(deps, brief.visitId, coverage);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function coverageOnBranch(
  deps: SpecCoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<PlanCoverage> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const [citable, specPlan] = await Promise.all([
    readJson<CitablePlan>(tools, "plan_blocks"),
    tools.read("spec_plan"),
  ]);
  const specFiles = await Promise.all(
    specPathsOfPlan(specPlan.toString("utf8")).map((path) =>
      deps.readSpec(repo, path, branch),
    ),
  );

  return planCoverage(
    citable.blocks,
    specFiles.filter((spec): spec is string => spec !== null),
  );
}

async function readJson<T>(tools: Tools, need: string): Promise<T> {
  return JSON.parse((await tools.read(need)).toString("utf8")) as T;
}

/** Every block cited, or the budget spent, lets the spec PR open; otherwise the writer goes round again. */
async function verdict(
  deps: SpecCoverageDeps,
  visitId: string,
  coverage: PlanCoverage,
): Promise<Report> {
  if (coverage.missing.length === 0) {
    return SUCCESS;
  }
  const spent = coverageRoundsSpent(await deps.visitsOf(visitId));

  return spent < COVERAGE_ROUNDS ? { outcome: "changes_requested" } : SUCCESS;
}

const productionDeps: SpecCoverageDeps = {
  readSpec: async (repo, path, ref) =>
    (await projectFor(repo)).repo.read(path, ref),
  visitsOf: async (visitId) => {
    const visit = await floorClient().stationRuns.get(visitId);

    return visit ? floorClient().stationRuns.list({ run: visit.runId }) : [];
  },
};

export function startSpecCoverageStation(): RunningStation {
  return defineStation("spec-coverage", specCoverageHandle(productionDeps));
}
