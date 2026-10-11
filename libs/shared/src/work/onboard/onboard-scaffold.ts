// The verbatim half of onboarding: the canonical workflows and the static templates, committed by Lore before the onboard line's agent runs — an LLM retyping YAML it was handed is how a workflow drifts from its canonical version.

import { errorMessage, type StepFailure } from "../../lib/error-classify.js";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
} from "../ingest-workflow.js";
import {
  ONBOARD_STATIC_FILES,
  type OnboardFileOwner,
} from "../onboard-content.js";
import {
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
} from "../trace-impact-workflow.js";

/** The slice of `project.repo` the scaffold needs — narrow so tests need no Project. */
export interface ScaffoldRepo {
  read(path: string, ref?: string): Promise<string | null>;
  commitFile(
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<void>;
}

export interface OnboardScaffoldResult {
  committed: string[];
  failures: StepFailure[];
}

interface ScaffoldFile {
  path: string;
  owner: OnboardFileOwner;
  content: string;
}

/** Every deterministic file: the two workflows are Lore's, the static templates carry their own owner. */
const SCAFFOLD_FILES: readonly ScaffoldFile[] = [
  {
    path: LORE_INGEST_WORKFLOW_PATH,
    owner: "lore",
    content: LORE_INGEST_WORKFLOW_CONTENT,
  },
  {
    path: TRACE_IMPACT_WORKFLOW_PATH,
    owner: "lore",
    content: TRACE_IMPACT_WORKFLOW_CONTENT,
  },
  ...ONBOARD_STATIC_FILES,
];

/** Whether a file is committed, given what the branch holds at its path. A Lore-owned file is committed whenever it differs from the canonical content — that IS the update; a repo-owned one only when absent. An identical file is never committed: GitHub's contents API makes a commit even for identical bytes, and an up-to-date repo would get an empty pull request. */
export function decideScaffoldCommit(
  file: Pick<ScaffoldFile, "owner" | "content">,
  current: string | null,
): boolean {
  return current === null;
}

/** Brings the branch's deterministic files to today's requirements — the same rule for a first onboarding and a hand-triggered update. A failed file is recorded, never thrown: the agent still owes its half, and the ticket comment reports the gap. */
export async function commitOnboardScaffold(
  repo: ScaffoldRepo,
  branch: string,
): Promise<OnboardScaffoldResult> {
  const result: OnboardScaffoldResult = { committed: [], failures: [] };

  for (const file of SCAFFOLD_FILES) {
    try {
      await commitScaffoldFile(repo, branch, file, result);
    } catch (err) {
      console.error(`[onboard] failed ${file.path}: ${errorMessage(err)}`);
      result.failures.push({ step: file.path, error: errorMessage(err) });
    }
  }

  return result;
}

async function commitScaffoldFile(
  repo: ScaffoldRepo,
  branch: string,
  file: ScaffoldFile,
  result: OnboardScaffoldResult,
): Promise<void> {
  const current = await repo.read(file.path, branch);

  if (!decideScaffoldCommit(file, current)) {
    return handleScaffoldSkip(file, current, result);
  }
  await repo.commitFile(
    branch,
    file.path,
    file.content,
    `lore: update ${file.path}`,
  );
  result.committed.push(file.path);
}

function handleScaffoldSkip(
  file: ScaffoldFile,
  current: string | null,
  result: OnboardScaffoldResult,
): void {
  if (current !== null && current !== file.content) {
    result.failures.push({
      step: file.path,
      error: "drifted from canonical template",
    });
  }
}
