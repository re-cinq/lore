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
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import {
  parseDecomposition,
  type DecompTask,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import {
  groundingBrief,
  type GroundedFile,
} from "@re-cinq/lore-shared/feature-planning/grounding.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import {
  decomposedSpec,
  type DecomposedSpec,
} from "../file-issues/decomposed-spec.js";
import { coverageDeps, type CoverageDeps } from "../coverage-deps.js";
import { addedAcross, findingsIn, groundedText } from "../grounded-text.js";

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

      return await verdict(deps, brief.visitId, coverage.gaps);
    } catch (err) {
      return { outcome: "failed", error: (err as Error).message };
    }
  };
}

interface CountedDecomposition {
  /** Statements no task names, plus names the tasks give that are not on main. */
  gaps: number;
  brief: string;
}

async function coverageOfDecomposition(
  deps: CoverageDeps,
  brief: Brief,
  tools: Tools,
): Promise<CountedDecomposition | undefined> {
  const { repo, branch } = parseGitRef(brief.needs.target);
  const decomposition = await decompositionOf(tools);
  const spec = await specOf(deps, brief, decomposition);

  if (!spec) {
    return undefined;
  }
  const tree = await deps.listTree(repo, branch);
  const grounded = await groundedTasks(decomposition, tree, (path) =>
    deps.readSpec(repo, path, branch),
  );

  return countedIn(spec, decomposition, grounded);
}

/** The spec at the commit the decomposition read, or at the branch when it names none. */
function specOf(
  deps: CoverageDeps,
  brief: Brief,
  decomposition: DecompositionResult,
): Promise<DecomposedSpec | undefined> {
  const { repo, branch } = parseGitRef(brief.needs.target);

  return decomposedSpec((path, ref) => deps.readSpec(repo, path, ref), {
    repo,
    branch,
    specPath: brief.needs.spec_path,
    commit: decomposition.spec_commit,
  });
}

/** Each task's text, the plan it quotes first, grounded on the base branch. */
function groundedTasks(
  decomposition: DecompositionResult,
  tree: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<GroundedFile[]> {
  const tasks = decomposition.stories.flatMap((story) => story.tasks);
  const texts = tasks.map((task) => ({ path: task.id, text: taskText(task) }));
  const added = addedAcross(texts);

  return Promise.all(
    texts.map((text) => groundedText(text, tree, read, added)),
  );
}

function taskText(task: DecompTask): string {
  return [
    task.changes,
    ...(task.plan_quotes ?? []),
    task.context,
    ...(task.acceptance_criteria ?? []),
    task.test_plan,
    task.title,
    task.description,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

async function decompositionOf(tools: Tools): Promise<DecompositionResult> {
  const raw = (await tools.read("decomposition")).toString("utf8");

  return parseDecomposition(parseModelJson(raw));
}

function countedIn(
  spec: DecomposedSpec,
  decomposition: DecompositionResult,
  grounded: readonly GroundedFile[],
): CountedDecomposition {
  const counted = issueCoverage(
    spec.parts,
    decomposition.stories.flatMap((story) => story.tasks),
  );

  return {
    gaps: counted.missing.length + findingsIn(grounded),
    brief: issueCoverageBrief(counted, spec.linkOf) + groundingBrief(grounded),
  };
}

/** Every statement named and every name on main, or the budget spent, settles the run; otherwise decompose goes round again. */
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
    "issue-coverage",
  );

  return spent < COVERAGE_ROUNDS ? { outcome: "changes_requested" } : SUCCESS;
}

export function startIssueCoverageStation(): RunningStation {
  return defineStation("issue-coverage", issueCoverageHandle(coverageDeps));
}
