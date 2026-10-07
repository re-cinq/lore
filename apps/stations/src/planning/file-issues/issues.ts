// The issues station: files a plan's ONE story issue and one issue per task, each a native sub-issue of the story, and the spec-task that implements each task issue — once: a rerun rewrites what it filed before rather than filing a second set. Deterministic — the judgement (which slices, which tasks, what each task needs) already happened upstream in decompose, and this only writes what the artifact says. It's also the first thing to read that artifact as DATA rather than prose, so a bad label sends the decomposition back (`changes_requested` re-runs decompose against the objection, specs/6-dark-factory FR6.18) rather than being dropped or failing the line.

import { createStationProject } from "@re-cinq/lore-shared/project/index.js";
import { decideIssueWork } from "@re-cinq/lore-shared/feature-planning/issue-work.js";
import type { StoryIssueInput } from "@re-cinq/lore-shared/feature-planning/issue-bodies.js";
import {
  parseDecomposition,
  type DecompositionResult,
} from "@re-cinq/lore-shared/feature-planning/decomposition-result.js";
import { parseModelJson } from "@re-cinq/lore-shared/feature-planning/model-json.js";
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import {
  filePlanIssues,
  type FilingContext,
  type StationProject,
} from "./plan-issue-filing.js";
import { planUrlOf } from "@re-cinq/lore-shared/feature-planning/plan-url.js";
import {
  issueCoverage,
  issueCoverageBrief,
} from "@re-cinq/lore-shared/feature-planning/issue-coverage.js";
import { decomposedSpec, type DecomposedSpec } from "./decomposed-spec.js";

export interface IssuesStationDeps {
  /** Injectable project for tests; defaults to the pod's HTTP facade. */
  project?: ReturnType<typeof createStationProject>;
  /** The web UI's base address, for the story issue's plan link; defaults to `LORE_UI_URL`. */
  uiUrl?: string;
}

// The decomposition rides in on `params.feature_decomposition` — the artifact decompose produced, merged into the line's args by the Floor; a run reaching here without it is a wiring failure, not a bad decomposition, so it fails rather than asking the agent to fix something it did nothing wrong about.
export async function runIssuesStation(
  input: StationInput,
  deps: IssuesStationDeps = {},
): Promise<NodeResult> {
  const raw = input.params.feature_decomposition;

  if (!raw) {
    return missingDecomposition();
  }
  const project = deps.project ?? createStationProject(input.repo);
  const decomposition = parseDecomposition(parseModelJson(raw));
  const work = await planWork(project, decomposition, input);

  if (work.outcome === "changes_requested") {
    return rework(work.objection);
  }

  const context = filingContext(input, decomposition, {
    uiUrl: deps.uiUrl,
    spec: await specOfRun(project, input, decomposition),
  });

  return filed(await filePlanIssues(project, work, context), work.tasks.length);
}

async function planWork(
  project: StationProject,
  decomposition: DecompositionResult,
  input: StationInput,
) {
  return decideIssueWork(
    decomposition,
    await project.issues.listLabels(),
    input.params.plan_title,
  );
}

function specOfRun(
  project: StationProject,
  input: StationInput,
  decomposition: DecompositionResult,
): Promise<DecomposedSpec | undefined> {
  return decomposedSpec((path, ref) => project.repo.read(path, ref), {
    repo: input.repo,
    branch: input.branch,
    specPath: input.params.spec_path,
    commit: decomposition.spec_commit,
    planId: input.params.plan_id,
  });
}

// A run reaching this node with no decomposition is a WIRING failure, not a bad decomposition — so it fails rather than routing to rework, which would ask the agent to fix something it did nothing wrong about.
function missingDecomposition(): NodeResult {
  console.log(
    eventLine(
      "no decomposition reached this node — the artifact was never merged into the line",
    ),
  );

  return { outcome: "failed" };
}

// The decomposition is readable but not fileable. The objection rides in extras so the agent that produced it gets told what to change.
function rework(objection: string): NodeResult {
  console.log(eventLine(`rework: ${objection}`));

  return {
    outcome: "changes_requested",
    extras: { "Lore-Issues-Objection": objection },
  };
}

interface FilingSources {
  uiUrl: string | undefined;
  spec: DecomposedSpec | undefined;
}

// The plan id is what a rerun recognises its issues by.
function filingContext(
  input: StationInput,
  decomposition: DecompositionResult,
  { uiUrl, spec }: FilingSources,
): FilingContext {
  const planId = input.params.plan_id;

  return {
    input,
    story: {
      ...storyInput(input, decomposition, uiUrl),
      ...storyCoverage(decomposition, spec),
    },
    ...(planId ? { planId } : {}),
    ...(spec ? { spec } : {}),
  };
}

function storyCoverage(
  decomposition: DecompositionResult,
  spec: DecomposedSpec | undefined,
): { coverage?: string } {
  if (!spec) {
    return {};
  }
  const tasks = decomposition.stories.flatMap((story) => story.tasks);

  return {
    coverage: issueCoverageBrief(issueCoverage(spec.parts, tasks), spec.linkOf),
  };
}

/** What the story issue's body is built from; the task issue numbers join it once they exist. */
function storyInput(
  input: StationInput,
  decomposition: DecompositionResult,
  uiUrl = process.env.LORE_UI_URL,
): StoryIssueInput {
  const {
    plan_id: planId,
    plan_title: planTitle,
    plan_md: planMarkdown,
  } = input.params;
  const specSlug = specSlugOf(input.params.spec_path);

  return {
    repo: input.repo,
    stories: decomposition.stories,
    ...(planTitle ? { planTitle } : {}),
    ...storyPlanUrl(uiUrl, input.repo, planId),
    ...(specSlug ? { specSlug } : {}),
    ...(planMarkdown ? { planMarkdown } : {}),
  };
}

// The spec's directory under specs/ — what the story issue names the feature by.
function specSlugOf(specPath: string | undefined): string | undefined {
  return specPath?.match(/^specs\/([^/]+)/)?.[1];
}

function storyPlanUrl(
  uiUrl: string | undefined,
  repo: string,
  planId: string | undefined,
): { planUrl?: string } {
  const planUrl = planId ? planUrlOf(uiUrl, repo, planId) : undefined;

  return planUrl ? { planUrl } : {};
}

function filed(storyNumber: number, taskCount: number): NodeResult {
  return {
    outcome: "success",
    extras: {
      "Lore-Story-Issue": String(storyNumber),
      "Lore-Issues": String(1 + taskCount),
    },
  };
}
