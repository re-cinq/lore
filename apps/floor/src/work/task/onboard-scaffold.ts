// The verbatim half of onboarding: the canonical workflows and the static templates, committed by the Floor before the onboard line's agent runs — an LLM retyping YAML it was handed is how a workflow drifts from its canonical version.

import {
  errorMessage,
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  ONBOARD_STATIC_FILES,
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
  type StepFailure,
} from "@re-cinq/lore-shared";

/** The slice of `project.repo` the scaffold needs — narrow so tests need no Project. */
export interface ScaffoldRepo {
  tree(ref?: string): Promise<string[]>;
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
  content: string;
}

/** Always reinstalled at the canonical version: a stale workflow is exactly what a re-onboard repairs. */
const WORKFLOW_FILES: readonly ScaffoldFile[] = [
  { path: LORE_INGEST_WORKFLOW_PATH, content: LORE_INGEST_WORKFLOW_CONTENT },
  { path: TRACE_IMPACT_WORKFLOW_PATH, content: TRACE_IMPACT_WORKFLOW_CONTENT },
];

/** Commits the workflows and every static template the branch does not already carry. A failed file is recorded, never thrown: the agent still owes its half, and the ticket comment reports the gap. */
export async function commitOnboardScaffold(
  repo: ScaffoldRepo,
  branch: string,
): Promise<OnboardScaffoldResult> {
  const result: OnboardScaffoldResult = { committed: [], failures: [] };
  const present = await presentPaths(repo, branch);

  for (const file of scaffoldFilesOwed(present)) {
    await commitScaffoldFile(repo, branch, file, result);
  }

  return result;
}

/** The workflows, then the static files whose exact path the branch lacks. Exact path, not top-level directory: a repo with a `.github/` still needs its issue templates (#1201). */
export function scaffoldFilesOwed(
  present: ReadonlySet<string>,
): ScaffoldFile[] {
  return [
    ...WORKFLOW_FILES,
    ...ONBOARD_STATIC_FILES.filter((file) => !present.has(file.path)),
  ];
}

/** An unreadable tree means nothing can be proven present, so every static file is offered; commitFile upserts, so an existing one is rewritten with its own canonical content rather than lost. */
async function presentPaths(
  repo: ScaffoldRepo,
  branch: string,
): Promise<Set<string>> {
  try {
    return new Set(await repo.tree(branch));
  } catch (err) {
    console.warn(
      `[floor] Onboard: could not list ${branch}: ${errorMessage(err)}`,
    );

    return new Set();
  }
}

async function commitScaffoldFile(
  repo: ScaffoldRepo,
  branch: string,
  file: ScaffoldFile,
  result: OnboardScaffoldResult,
): Promise<void> {
  try {
    await repo.commitFile(
      branch,
      file.path,
      file.content,
      `lore: add ${file.path}`,
    );
    result.committed.push(file.path);
  } catch (err) {
    console.error(`[floor] Onboard: failed ${file.path}: ${errorMessage(err)}`);
    result.failures.push({ step: file.path, error: errorMessage(err) });
  }
}
