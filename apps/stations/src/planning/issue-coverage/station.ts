// After the issues station files a plan's tickets, counts which testable statements of the merged spec no task names, and sends decompose back with only those until the coverage round budget is spent; then the run settles with the gaps listed on the story issue.

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
  coverageRoundsSpent,
} from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import {
  issueCoverage,
  issueCoverageBrief,
  type IssueCoverage,
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import {
  parseDecomposition,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  decomposedSpec,
  type DecomposedSpec,
} from "../file-issues/decomposed-spec.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";

const SUCCESS: Report = { outcome: "success" };

export function issueCoverageHandle(deps: CoverageDeps): Handle {
  return async (brief, tools) => {
    try {
      const coverage = await coverageOfDecomposition(deps, brief, tools);

      // A plan naming no spec, or a spec not on the branch, leaves nothing to count.
      if (!coverage) {
        return SUCCESS;
      }
      await tools.produce("issue_coverage", coverage.brief);

      return await verdict(deps, brief.visitId, coverage.counted);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

async function coverageOfDecomposition(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<{ counted: IssueCoverage; brief: string } | undefined> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const decomposition = await decompositionOf(tools);
  const spec = await decomposedSpec(
    (path, ref) => deps.readSpec(repo, path, ref),
    {
      repo,
      branch,
      specPath: brief.needs.spec_path,
      commit: decomposition.spec_commit,
    },
  );

  return spec && countedIn(spec, decomposition);
}

async function decompositionOf(tools: Tools): Promise<DecompositionResult> {
  const raw = (await tools.read("decomposition")).toString("utf8");

  return parseDecomposition(parseModelJson(raw));
}

function countedIn(
  spec: DecomposedSpec,
  decomposition: DecompositionResult,
): { counted: IssueCoverage; brief: string } {
  const counted = issueCoverage(
    spec.parts,
    decomposition.stories.flatMap((story) => story.tasks),
  );

  return { counted, brief: issueCoverageBrief(counted, spec.linkOf) };
}

/** Every statement named, or the budget spent, settles the run; otherwise decompose goes round again. */
async function verdict(
  deps: CoverageDeps,
  visitId: string,
  coverage: IssueCoverage,
): Promise<Report> {
  if (coverage.missing.length === 0) {
    return SUCCESS;
  }
  const spent = coverageRoundsSpent(
    await deps.visitsOf(visitId),
    "issue-coverage",
  );

  return spent < COVERAGE_ROUNDS ? { outcome: "changes_requested" } : SUCCESS;
}

export function startIssueCoverageStation(): RunningStation {
  return defineStation("issue-coverage", issueCoverageHandle(coverageDeps));
}
