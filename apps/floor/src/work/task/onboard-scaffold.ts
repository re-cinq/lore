// The verbatim half of onboarding: the canonical workflows and the static templates, committed by the Floor before the onboard line's agent runs — an LLM retyping YAML it was handed is how a workflow drifts from its canonical version.

import {
  errorMessage,
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  ONBOARD_STATIC_FILES,
  type OnboardFileOwner,
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
  type StepFailure,
} from "@re-cinq/lore-shared";

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
  return file.owner === "lore" ? current !== file.content : current === null;
}

/** Brings the branch's deterministic files to today's requirements — the same rule for a first onboarding and a hand-triggered update. A failed file is recorded, never thrown: the agent still owes its half, and the ticket comment reports the gap. */
export async function commitOnboardScaffold(
  repo: ScaffoldRepo,
  branch: string,
): Promise<OnboardScaffoldResult> {
  const result: OnboardScaffoldResult = { committed: [], failures: [] };

  for (const file of SCAFFOLD_FILES) {
    await commitScaffoldFile(repo, branch, file, result);
  }

  return result;
}

async function commitScaffoldFile(
  repo: ScaffoldRepo,
  branch: string,
  file: ScaffoldFile,
  result: OnboardScaffoldResult,
): Promise<void> {
  const { path, content } = file;

  try {
    if (!decideScaffoldCommit(file, await repo.read(path, branch))) {
      return;
    }
    await repo.commitFile(branch, path, content, `lore: update ${path}`);
    result.committed.push(path);
  } catch (err) {
    console.error(`[floor] Onboard: failed ${path}: ${errorMessage(err)}`);
    result.failures.push({ step: path, error: errorMessage(err) });
  }
}
