// What the spec on the branch still owes the approved plan, counted without a model: plan blocks no statement cites, names the files do not have on main, and requirements that are compound or unbacked (see specs/external-floor/spec.md FR8.22).

import type { Brief, Tools } from "@re-cinq/floor-station";
import {
  coverageBrief,
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
import type { CoverageDeps } from "../coverage-deps.js";
import { addedAcross, findingsIn, groundedText } from "../grounded-text.js";
import { changedLines, onChangedLines } from "./changed-lines.js";

export interface BranchChecks {
  /** The brief the writer reads on its next visit. */
  brief: string;
  gaps: number;
}

/** Every spec the plan creates or updates, as the branch holds them; null where the run carries no spec plan to find them by. */
export async function specsOfBranch(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<SpecFile[] | null> {
  if (!brief.needs.spec_plan) {
    return null;
  }
  const { repo, branch } = parseGitRef(brief.needs.target);
  const specPlan = (await tools.read("spec_plan")).toString("utf8");

  return specsOnBranch(specPlan, (path) => deps.readSpec(repo, path, branch));
}

/** Null where the deployment hands the run no blocks to cite: then there is nothing to count. */
export async function branchChecks(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
  specs: readonly SpecFile[],
): Promise<BranchChecks | null> {
  if (!brief.needs.plan_blocks) {
    return null;
  }
  const found = await coverageOnBranch(deps, brief, tools, specs);

  return { brief: briefOf(found), gaps: gapsOf(found) };
}

function briefOf({ coverage, grounded, unsound }: SpecsOnBranch): string {
  return (
    coverageBrief(coverage) + groundingBrief(grounded) + soundnessBrief(unsound)
  );
}

function gapsOf({ coverage, grounded, unsound }: SpecsOnBranch): number {
  return gapsIn(coverage, grounded, unsound);
}

interface SpecsOnBranch {
  coverage: PlanCoverage;
  grounded: GroundedFile[];
  unsound: SoundnessFinding[];
}

async function coverageOnBranch(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
  specs: readonly SpecFile[],
): Promise<SpecsOnBranch> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const read = (path: string) => deps.readSpec(repo, path, branch);
  const [citable, tree, written] = await Promise.all([
    readJson<CitablePlan>(tools, "plan_blocks"),
    deps.listTree(repo, branch),
    linesWritten(specs, (path) => deps.readSpec(repo, path)),
  ]);

  return countsOf(
    citable,
    specs,
    await groundedSpecs(specs, tree, read, written),
    written,
  );
}

/** Per spec path, the lines this plan's writer wrote: the whole of a spec the default branch lacks, the changed lines of one it has. */
async function linesWritten(
  specs: readonly SpecFile[],
  readOnDefault: (path: string) => Promise<string | null>,
): Promise<Map<string, Set<number>>> {
  const entries = await Promise.all(
    specs.map(
      async (spec) =>
        [
          spec.path,
          changedLines(spec.text, await readOnDefault(spec.path)),
        ] as const,
    ),
  );

  return new Map(entries);
}

function countsOf(
  citable: CitablePlan,
  specs: readonly SpecFile[],
  grounded: GroundedFile[],
  written: ReadonlyMap<string, Set<number>>,
): SpecsOnBranch {
  return {
    coverage: planCoverage(
      citable.blocks,
      specs.map((spec) => spec.text),
    ),
    grounded,
    unsound: specSoundness(specs).filter((finding) =>
      written.get(finding.path)?.has(finding.line),
    ),
  };
}

/** Each spec grounded on the lines its writer wrote, what any of them says the feature adds counting for all. */
async function groundedSpecs(
  specs: readonly SpecFile[],
  tree: readonly string[],
  read: (path: string) => Promise<string | null>,
  written: ReadonlyMap<string, Set<number>>,
): Promise<GroundedFile[]> {
  const added = addedAcross(specs);
  const grounded = await Promise.all(
    specs.map((spec) => groundedText(spec, tree, read, added)),
  );

  return grounded.map((file) => ({
    ...file,
    findings: onChangedLines(
      file.findings,
      written.get(file.path) ?? new Set(),
    ),
  }));
}

export interface SpecFile {
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
