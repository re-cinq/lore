/** Committing onboarding files: the static/workflow set verbatim, the generated set via one LLM call each. */

import { errorMessage, type StepFailure } from "@re-cinq/lore-shared";
import { Llm } from "@re-cinq/lore-shared";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
} from "@re-cinq/lore-shared";
import { projectFor } from "../../outbound/project-boot.js";
import type { TaskHandlerInput } from "./task-handler-input.js";
import { ONBOARD_STATIC_FILES } from "./onboard-content.js";
import { summarizeFailures, TaskFailure } from "@re-cinq/lore-shared";
import type { planOnboardFiles } from "./onboard-plan.js";

/** Where a committed file is recorded: the list the PR body reports, and the failures it reports alongside them. */
interface OnboardLedger {
  kind: string;
  committed: string[];
  failures: StepFailure[];
}

/** Everything one generated file needs: where to commit it and what task it belongs to. */
interface OnboardGenerationContext {
  project: Awaited<ReturnType<typeof projectFor>>;
  branchName: string;
  contextStr: string;
  task: TaskHandlerInput["task"];
  model: TaskHandlerInput["model"];
}

/** Everything committing an onboarding needs: where to commit, what the repo already has, and what to generate. */
export interface OnboardCommitInput {
  project: Awaited<ReturnType<typeof projectFor>>;
  branchName: string;
  existingFiles: Set<string>;
  contextStr: string;
  task: TaskHandlerInput["task"];
  model: TaskHandlerInput["model"];
  toGenerate: Awaited<ReturnType<typeof planOnboardFiles>>;
}

export async function commitOnboardFiles(
  input: OnboardCommitInput,
): Promise<{ committed: string[]; failures: StepFailure[] }> {
  const { project, branchName, existingFiles, contextStr, task, model } = input;
  const committed: string[] = [];
  const failures: StepFailure[] = [];

  await commitWorkflowFiles(project, branchName, committed, failures);
  await commitMissingStaticFiles(project, branchName, existingFiles, {
    committed,
    failures,
  });
  await generateAndCommitFiles(
    { project, branchName, contextStr, task, model },
    input.toGenerate,
    { committed, failures },
  );

  enforceCommittedSomething(committed, failures);

  return { committed, failures };
}

/** Always-reinstalled workflow files; skip doesn't apply to these upserted `.github` files. */
async function commitWorkflowFiles(
  project: Awaited<ReturnType<typeof projectFor>>,
  branchName: string,
  committed: string[],
  failures: StepFailure[],
): Promise<void> {
  for (const workflow of [
    { path: LORE_INGEST_WORKFLOW_PATH, content: LORE_INGEST_WORKFLOW_CONTENT },
    {
      path: TRACE_IMPACT_WORKFLOW_PATH,
      content: TRACE_IMPACT_WORKFLOW_CONTENT,
    },
  ]) {
    await commitOnboardFile(project, branchName, workflow, {
      kind: "workflow",
      committed,
      failures,
    });
  }
}

/** Static files the repo doesn't already have (by exact path or top-level dir). */
async function commitMissingStaticFiles(
  project: Awaited<ReturnType<typeof projectFor>>,
  branchName: string,
  existingFiles: Set<string>,
  ledger: { committed: string[]; failures: StepFailure[] },
): Promise<void> {
  for (const sf of ONBOARD_STATIC_FILES) {
    if (alreadyPresent(sf.path, existingFiles)) {
      continue;
    }

    await commitOnboardFile(
      project,
      branchName,
      { path: sf.path, content: sf.content },
      { kind: "static", ...ledger },
    );
  }
}

/** Commit one onboarding file, recording it either way. A failure here is reported in the PR body rather than failing the task — a repo that got most of its files is still onboarded. */
async function commitOnboardFile(
  project: Awaited<ReturnType<typeof projectFor>>,
  branchName: string,
  file: { path: string; content: string },
  ledger: OnboardLedger,
): Promise<void> {
  try {
    await project.repo.commitFile(
      branchName,
      file.path,
      file.content,
      `lore: add ${file.path}`,
    );
    ledger.committed.push(file.path);
    console.log(`[floor] Onboard: committed ${file.path} (${ledger.kind})`);
  } catch (err) {
    console.error(`[floor] Onboard: failed ${file.path}: ${errorMessage(err)}`);
    ledger.failures.push({ step: file.path, error: errorMessage(err) });
  }
}

/** A static file counts as present when the repo has the exact path or its whole top-level directory. */
function alreadyPresent(path: string, existingFiles: Set<string>): boolean {
  const [topDir] = path.split("/");

  return existingFiles.has(path) || existingFiles.has(topDir);
}

/** Generate + commit every planned file, one LLM call each. */
async function generateAndCommitFiles(
  ctx: OnboardGenerationContext,
  toGenerate: { path: string; prompt: string }[],
  ledger: { committed: string[]; failures: StepFailure[] },
): Promise<void> {
  for (const file of toGenerate) {
    await generateAndCommitOneFile(ctx, file, ledger);
  }
}

/** Generate and commit one planned file; a file the model declines to write is skipped rather than committed empty. */
async function generateAndCommitOneFile(
  ctx: OnboardGenerationContext,
  file: { path: string; prompt: string },
  ledger: { committed: string[]; failures: StepFailure[] },
): Promise<void> {
  try {
    const result = await generateFileContent(ctx, file);

    const text = result.text.trim();

    // Very short output is treated as a SKIP too: a model that writes three words has declined without saying so, and committing them would look like a real file.
    if (text === "SKIP" || text.length < 20) {
      console.log(
        `[floor] Onboard: skipping ${file.path} (model returned SKIP)`,
      );

      return;
    }

    await commitGenerated(ctx, file.path, text, ledger);
  } catch (err) {
    recordGenerationFailure(file.path, err, ledger);
  }
}

/** Asks for one file's content. The system prompt insists on RAW content — a model that helpfully wraps its answer in a code fence produces a file whose first line is ``` and whose parser then rejects it. */
async function generateFileContent(
  ctx: OnboardGenerationContext,
  file: { path: string; prompt: string },
) {
  return Llm.instance.complete({
    prompt: `${file.prompt}\n\n## Repository Context\n\n${ctx.contextStr}`,
    systemPrompt: `Generate the content for ${file.path}. Output ONLY the file content — no explanation, no markdown code fences, no preamble. Start directly with the file content.`,
    model: ctx.model,
    maxTokens: 8192,
    taskId: ctx.task.id,
  });
}

/** Commits one generated file and records it. The ledger is the PR's contents list — a file committed but not recorded would ship in the branch and go unmentioned in the body. */
async function commitGenerated(
  ctx: OnboardGenerationContext,
  path: string,
  text: string,
  ledger: { committed: string[] },
): Promise<void> {
  const { repo } = ctx.project;

  await repo.commitFile(ctx.branchName, path, text, `lore: add ${path}`);
  ledger.committed.push(path);
  console.log(`[floor] Onboard: committed ${path} (${text.length} chars)`);
}

/** A generation failure is recorded, not thrown — the task fails only when nothing came through at all. */
function recordGenerationFailure(
  path: string,
  err: unknown,
  ledger: { failures: StepFailure[] },
): void {
  console.error(
    `[floor] Onboard: failed to generate ${path}: ${errorMessage(err)}`,
  );
  ledger.failures.push({ step: path, error: errorMessage(err) });
}

/** Commit every onboarding file, collecting failures rather than stopping: a repo that gets nine of ten files is onboarded, and the tenth becomes an attention note on the PR. A run that commits NOTHING is the only failure. */
/** An onboarding that committed nothing is a failure, not an empty onboarding — the PR would ask a human to review a branch with no files. The individual step failures ride along, so the error says WHICH generations failed rather than only that they all did. */
function enforceCommittedSomething(
  committed: string[],
  failures: StepFailure[],
): void {
  if (committed.length > 0) {
    return;
  }
  const { summary, details } = summarizeFailures(failures);

  throw new TaskFailure(
    summary
      ? `Failed to generate any onboarding files — ${summary}`
      : "Failed to generate any onboarding files",
    details,
  );
}
