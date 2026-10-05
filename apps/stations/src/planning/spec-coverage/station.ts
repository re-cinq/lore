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
import {
  groundingBrief,
  groundingFindings,
  namedPaths,
  type GroundedFile,
} from "@re-cinq/lore-shared/feature-planning/grounding.js";
import { specPathsOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";

const SUCCESS: Report = { outcome: "success" };

export function specCoverageHandle(deps: CoverageDeps): Handle {
  return async (brief, tools) => {
    // A deployment that names no web UI hands the run no blocks to cite, so there is nothing to count.
    if (!brief.needs.plan_blocks) {
      return SUCCESS;
    }

    try {
      const { coverage, grounded } = await coverageOnBranch(deps, brief, tools);

      await tools.produce(
        "plan_coverage",
        coverageBrief(coverage) + groundingBrief(grounded),
      );

      return await verdict(deps, brief.visitId, gapsIn(coverage, grounded));
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

interface SpecsOnBranch {
  coverage: PlanCoverage;
  grounded: GroundedFile[];
}

async function coverageOnBranch(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<SpecsOnBranch> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const read = (path: string) => deps.readSpec(repo, path, branch);
  const [citable, specPlan, tree] = await Promise.all([
    readJson<CitablePlan>(tools, "plan_blocks"),
    tools.read("spec_plan"),
    deps.listTree(repo, branch),
  ]);
  const specs = await specsOnBranch(specPlan.toString("utf8"), read);

  const grounded = specs.map((spec) => groundedSpec(spec, tree, read));
  const texts = specs.map((spec) => spec.text);

  return {
    coverage: planCoverage(citable.blocks, texts),
    grounded: await Promise.all(grounded),
  };
}

interface SpecFile {
  path: string;
  text: string;
}

/** Every spec the plan creates or updates, as the branch holds it; one not on the branch is left out. */
async function specsOnBranch(
  specPlan: string,
  read: (path: string) => Promise<string | null>,
): Promise<SpecFile[]> {
  const specs = await Promise.all(
    specPathsOfPlan(specPlan).map(async (path) => ({
      path,
      text: await read(path),
    })),
  );

  return specs.filter((spec): spec is SpecFile => spec.text !== null);
}

/** One spec's findings, its identifiers checked against the files on the tree it names. */
async function groundedSpec(
  spec: SpecFile,
  tree: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<GroundedFile> {
  const named = namedPaths(spec.text).filter((path) => tree.includes(path));
  const contents = await Promise.all(named.map(read));
  const files = Object.fromEntries(
    named.flatMap((path, index) => {
      const content = contents[index];

      return content === null ? [] : [[path, content]];
    }),
  );

  return {
    path: spec.path,
    findings: groundingFindings({ text: spec.text, tree, files }),
  };
}

function gapsIn(
  coverage: PlanCoverage,
  grounded: readonly GroundedFile[],
): number {
  return (
    coverage.missing.length +
    grounded.reduce((sum, spec) => sum + spec.findings.length, 0)
  );
}

async function readJson<T>(tools: Tools, need: string): Promise<T> {
  return JSON.parse((await tools.read(need)).toString("utf8")) as T;
}

/** Every block cited and every name on main, or the budget spent, lets the spec PR open; otherwise the writer goes round again. */
async function verdict(
  deps: CoverageDeps,
  visitId: string,
  gaps: number,
): Promise<Report> {
  if (gaps === 0) {
    return SUCCESS;
  }
  const spent = coverageRoundsSpent(
    await deps.visitsOf(visitId),
    "spec-coverage",
  );

  return spent < COVERAGE_ROUNDS ? { outcome: "changes_requested" } : SUCCESS;
}

export function startSpecCoverageStation(): RunningStation {
  return defineStation("spec-coverage", specCoverageHandle(coverageDeps));
}
