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
  type GroundedFile,
} from "@re-cinq/lore-shared/feature-planning/grounding.js";
import {
  soundnessBrief,
  specSoundness,
  type SoundnessFinding,
} from "@re-cinq/lore-shared/feature-planning/spec-soundness.js";
import { specPathsOfPlan } from "@re-cinq/lore-shared/feature-planning/spec-plan-path.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";
import { addedAcross, findingsIn, groundedText } from "../grounded-text.js";

const SUCCESS: Report = { outcome: "success" };

export function specCoverageHandle(deps: CoverageDeps): Handle {
  return async (brief, tools) => {
    // A deployment that names no web UI hands the run no blocks to cite, so there is nothing to count.
    if (!brief.needs.plan_blocks) {
      return SUCCESS;
    }

    try {
      return await counted(deps, brief, tools);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

/** The brief the writer reads, and the verdict that sends it round again while the budget holds. */
async function counted(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<Report> {
  const { coverage, grounded, unsound } = await coverageOnBranch(
    deps,
    brief,
    tools,
  );

  await tools.produce(
    "plan_coverage",
    coverageBrief(coverage) +
      groundingBrief(grounded) +
      soundnessBrief(unsound),
  );

  return verdict(deps, brief.visitId, gapsIn(coverage, grounded, unsound));
}

interface SpecsOnBranch {
  coverage: PlanCoverage;
  grounded: GroundedFile[];
  unsound: SoundnessFinding[];
}

interface BranchRead {
  deps: CoverageDeps;
  tools: Tools;
  repo: string;
  branch: string;
  read: (path: string) => Promise<string | null>;
}

async function coverageOnBranch(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<SpecsOnBranch> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const read = (path: string) => deps.readSpec(repo, path, branch);
  const [citable, tree, specs] = await readBranch({
    deps,
    tools,
    repo,
    branch,
    read,
  });

  return countsOf(citable, specs, await groundedSpecs(specs, tree, read));
}

function countsOf(
  citable: CitablePlan,
  specs: readonly SpecFile[],
  grounded: GroundedFile[],
): SpecsOnBranch {
  return {
    coverage: planCoverage(
      citable.blocks,
      specs.map((spec) => spec.text),
    ),
    grounded,
    unsound: specSoundness(specs),
  };
}

/** The plan's blocks, the tree the names are checked against, and the specs as the branch holds them. */
function readBranch({
  deps,
  tools,
  repo,
  branch,
  read,
}: BranchRead): Promise<[CitablePlan, string[], SpecFile[]]> {
  return Promise.all([
    readJson<CitablePlan>(tools, "plan_blocks"),
    deps.listTree(repo, branch),
    tools
      .read("spec_plan")
      .then((specPlan) => specsOnBranch(specPlan.toString("utf8"), read)),
  ]);
}

/** Each spec grounded, what any of them says the feature adds counting for all. */
function groundedSpecs(
  specs: readonly SpecFile[],
  tree: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<GroundedFile[]> {
  const added = addedAcross(specs);

  return Promise.all(
    specs.map((spec) => groundedText(spec, tree, read, added)),
  );
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

function gapsIn(
  coverage: PlanCoverage,
  grounded: readonly GroundedFile[],
  unsound: readonly SoundnessFinding[],
): number {
  return coverage.missing.length + findingsIn(grounded) + unsound.length;
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
