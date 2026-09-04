import { errorMessage, BACKLOG_LABEL_SEED } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Onboard handler: generates Lore platform files (CLAUDE.md, AGENTS.md, ADRs, spec, CI, test-commands). */

import { Llm } from "@re-cinq/lore-shared";
import { projectFor } from "../../composition/project-boot.js";
import { memoryLifecycle } from "../../kernel/queues.js";
import { settings } from "../../kernel/queues.js";
import { fetchRepoContext } from "./repo-context.js";
import { writeEpisode } from "@re-cinq/lore-shared";
import {
  classifyError,
  failureHint,
  summarizeFailures,
  TaskFailure,
  type StepFailure,
} from "@re-cinq/lore-shared";
import {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_CONTENT,
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_CONTENT,
  LORE_TESTS_INSTRUCTION,
  decideTestInterfaceCheck,
} from "@re-cinq/lore-shared";
import {
  setStatus,
  insertEvent,
  issueRef,
  linkPrToIssue,
} from "./task-helpers.js";
import { writeAuditLog } from "../lib/audit.js";
import type { TaskHandlerInput } from "./task-handler-input.js";
import { DISPATCH_LABELS } from "@re-cinq/lore-shared/task-types/dispatch-labels.js";

// ── Onboard handler (per-file LLM calls) ─────────────────────────────

/** Files that the onboard process can generate. */
/** Static files that don't need LLM generation */
export const ONBOARD_STATIC_FILES: { path: string; content: string }[] = [
  {
    path: ".claude/settings.json",
    content: JSON.stringify(
      {
        systemPromptSuffix:
          "\n\nYou have access to the Lore MCP server. ALWAYS call get_context as your FIRST action before reading files or answering. Then use lore_search_memory to check what other developers learned. Before session ends, call lore_write_memory with a session summary.",
      },
      null,
      2,
    ),
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-implementation.yml",
    content: `name: "Lore: Implementation"
description: "Ask Lore to implement something in this repo"
labels: ["lore", "lore:implementation"]
body:
  - type: textarea
    id: description
    attributes:
      label: What should Lore implement?
      description: Describe what you want built. Be specific about files, behavior, and acceptance criteria.
      placeholder: "Add a health check endpoint at /healthz..."
    validations:
      required: true
  - type: input
    id: spec
    attributes:
      label: Spec file (optional)
      description: Path to a spec file in the repo for Lore to follow
      placeholder: "specs/my-feature/spec.md"
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-review.yml",
    content: `name: "Lore: Review"
description: "Ask Lore to review a PR against conventions"
labels: ["lore", "lore:review"]
body:
  - type: input
    id: pr_number
    attributes:
      label: PR number
      description: The pull request number to review
      placeholder: "42"
    validations:
      required: true
  - type: textarea
    id: focus
    attributes:
      label: Review focus (optional)
      description: Any specific areas to pay attention to
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/lore-general.yml",
    content: `name: "Lore: General Task"
description: "Ask Lore to do something (docs, runbook, analysis)"
labels: ["lore"]
body:
  - type: textarea
    id: description
    attributes:
      label: What should Lore do?
      description: Describe the task. Lore will use the repo's context.
      placeholder: "Write a runbook for handling database failover..."
    validations:
      required: true
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/config.yml",
    content: `blank_issues_enabled: true
contact_links:
  - name: Lore Dashboard
    url: https://LORE_UI_DOMAIN
    about: Create tasks directly in the Lore UI
`,
  },
];

export const ONBOARD_FILES: {
  path: string;
  description: string;
  prompt: string;
}[] = [
  {
    path: "AGENTS.md",
    description: "Agent configuration for AI tools",
    prompt:
      "Generate an AGENTS.md file for this repository. Include: context loading order (which files agents should read first), workflow commands (build, test, lint, deploy), commit conventions, PR requirements, and compliance constraints if any. Be specific to this repo's actual tech stack and structure.",
  },
  {
    path: ".github/PULL_REQUEST_TEMPLATE.md",
    description: "PR description template",
    prompt:
      "Generate a GitHub PR template. Include sections: ## Why, ## What Changed, ## Alternatives Considered, ## ADRs & Architecture, ## Testing. Add a checklist for code quality (lint, types, tests, no secrets).",
  },
  {
    path: ".github/workflows/pr-description-check.yml",
    description: "CI check for PR description quality",
    prompt:
      "Generate a GitHub Actions workflow that checks PR descriptions have required sections (## Why, ## What Changed, ## Testing). Use the github.event.pull_request.body context. Run on pull_request opened/edited. Fail if sections are missing.",
  },
  {
    path: ".specify/spec.md",
    description: "System specification",
    prompt:
      "Generate a system specification describing what this repository does based on the code structure, README, and config files. Include: overview, key capabilities, core data model (if applicable), user roles, business rules, and success metrics. Describe the system as it exists today.",
  },
];

/** Onboard scaffold prompt for suggested .lore/test-commands.yml (AC12); language-agnostic, team-reviewed. */
const TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT =
  "Generate a suggested `.lore/test-commands.yml` test-command manifest for this repository. Detect the actual test framework and coverage tooling from the repo's build files and config — never assume a runner. Declare three keys: `list` (a shell command that prints to stdout a JSON array of test descriptors `{id, name, file, startLine, endLine, spec?}`, where `id` is the framework's native, stable test node id), `run` (a shell command containing the literal `{selector}` placeholder that runs the single test named by that id with coverage and prints `{passed, covered:[{file, startLine, endLine}]}` or emits an lcov/cobertura report), and `coverage_format` (one of lcov | cobertura | json). For a monorepo, emit a top-level list with one entry per package, each carrying its own `cwd`. This is a suggested scaffold the team reviews and adjusts — do not change any test behaviour.";

/** ADR files are generated dynamically based on what's in the repo. */
const ADR_TOPICS = [
  {
    slug: "language-choice",
    prompt:
      "Write an ADR for the language/framework choice. Look at package.json, go.mod, Cargo.toml, etc. to determine what was chosen and why it makes sense for this project.",
  },
  {
    slug: "database-choice",
    prompt:
      "Write an ADR for the database choice. Look at config files, schema definitions, docker-compose for DB services. If no database is evident, skip this ADR entirely and respond with just 'SKIP'.",
  },
  {
    slug: "deployment",
    prompt:
      "Write an ADR for the deployment approach. Look at Dockerfile, CI workflows, Kubernetes manifests, serverless configs. Describe what was chosen and why.",
  },
];

/** Failure message safe for markdown bullets: collapsed newlines and length-capped. */
const asBulletText = (error: string): string => {
  const flat = error.replace(/\s+/g, " ").trim();

  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
};

/** True when any failure is missing Workflows App permission (shared detector, not status keying). */
const anyWorkflowsPermissionFailure = (failures: StepFailure[]): boolean =>
  failures.some(
    (f) =>
      classifyError(f.error, f.step).category === "github-workflows-permission",
  );

/** Onboarding PR's "what went wrong" section; missing workflows/config block re-ingest. */
function onboardAttentionSection(
  failures: StepFailure[],
  configFailures: string[],
  workflowsPermissionDenied: boolean,
): string {
  if (failures.length === 0 && configFailures.length === 0) {
    return "";
  }
  const lines = ["", "## Needs attention", ""];

  if (failures.length > 0) {
    lines.push("These files could not be committed:", "");

    for (const f of failures) {
      lines.push(`- \`${f.step}\` — ${asBulletText(f.error)}`);
    }
    lines.push("");
  }

  if (workflowsPermissionDenied) {
    lines.push(
      `GitHub rejected the workflow files: ${failureHint("github-workflows-permission")} Then re-run onboarding (or use the dashboard's fix-ingest button).`,
      "",
    );
  }

  if (configFailures.length > 0) {
    lines.push("Ingest callback configuration:", "");

    for (const failure of configFailures) {
      lines.push(`- ${asBulletText(failure)}`);
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n+$/, "");
}

/** What the repo already has, which decides what is worth generating. */
interface OnboardSurvey {
  existingFiles: Set<string>;
  hasAdrs: boolean;
}

/** The files this onboarding will generate: the standard set the repo lacks, the test-interface scaffold when it declares no manifest, and a starter ADR set when it has no adrs/ or docs/ yet. */
async function planOnboardFiles(
  targetRepo: string,
  { existingFiles, hasAdrs }: OnboardSurvey,
): Promise<{ path: string; prompt: string }[]> {
  const toGenerate: { path: string; prompt: string }[] = [];

  for (const f of ONBOARD_FILES) {
    const present =
      existingFiles.has(f.path) || existingFiles.has(f.path.split("/").pop()!);

    if (present) {
      console.log(`[floor] Onboard: skipping ${f.path} (already exists)`);
      continue;
    }
    toGenerate.push({ path: f.path, prompt: f.prompt });
  }
  toGenerate.push(...(await testInterfaceScaffold(targetRepo, existingFiles)));

  if (hasAdrs) {
    console.log(
      `[floor] Onboard: skipping ADRs (adrs/ or docs/ already exists)`,
    );

    return toGenerate;
  }
  toGenerate.push(...starterAdrs());

  return toGenerate;
}

/** Test-interface check (AC12): scaffold manifest + lore-tests.yml for repos without one. */
async function testInterfaceScaffold(
  targetRepo: string,
  existingFiles: Set<string>,
): Promise<{ path: string; prompt: string }[]> {
  const check = decideTestInterfaceCheck({
    manifestFileDeclared: existingFiles.has(".lore/test-commands.yml"),
    settingsTestCommands: await readSettingsTestCommands(targetRepo),
  });

  if (check.status === "configured") {
    console.log(
      "[floor] Onboard: test interface already configured — scaffolding nothing",
    );

    return [];
  }

  return check.files
    .filter((scaffoldPath) => !existingFiles.has(scaffoldPath))
    .map((scaffoldPath) => ({
      path: scaffoldPath,
      prompt:
        scaffoldPath === ".github/workflows/lore-tests.yml"
          ? LORE_TESTS_INSTRUCTION
          : TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
    }));
}

/** Unreadable settings are not a reason to fail onboarding; the check just falls back to "not declared". */
async function readSettingsTestCommands(targetRepo: string): Promise<unknown> {
  try {
    const repoSettings = await settings().rawSettings(targetRepo);

    return (repoSettings as { test_commands?: unknown } | null)?.test_commands;
  } catch (err) {
    console.warn(
      `[floor] Onboard: could not read repo settings for test-interface check: ${errorMessage(err)}`,
    );

    return undefined;
  }
}

/** The starter ADR set, numbered from 1, for a repo with no decision record yet. */
function starterAdrs(): { path: string; prompt: string }[] {
  const today = new Date().toISOString().split("T")[0];

  return ADR_TOPICS.map((adr, index) => {
    const adrNum = index + 1;

    return {
      path: `adrs/ADR-${String(adrNum).padStart(3, "0")}-${adr.slug}.md`,
      prompt:
        adr.prompt +
        ` Use MADR format with YAML frontmatter (adr_number: ${adrNum}, title, status: accepted, date: ${today}, domains: [...]).`,
    };
  });
}

/** Point the repo's workflows back at this Floor, BEFORE the PR opens so a failure here is still reportable in the PR body. An unset Floor value is never written as an empty variable — that would leave lore-ingest.yml failing on a blank URL while looking configured. */
async function configureIngestCallback(
  project: Awaited<ReturnType<typeof projectFor>>,
): Promise<string[]> {
  const failures: string[] = [];

  await setIngestVariable(project, failures);
  await setIngestSecret(project, failures);

  return failures;
}

async function setIngestVariable(
  project: Awaited<ReturnType<typeof projectFor>>,
  failures: string[],
): Promise<void> {
  const url = process.env.LORE_INGEST_URL || "";

  if (!url) {
    failures.push(
      "`LORE_INGEST_URL` is not configured on the Floor — set the repo variable manually or fix the Floor deployment, or ingest calls will never reach Lore",
    );

    return;
  }
  await project.settings
    .setRepoVariable("LORE_INGEST_URL", url)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_URL\` repo variable could not be set: ${errorMessage(err)}`,
      ),
    );
}

async function setIngestSecret(
  project: Awaited<ReturnType<typeof projectFor>>,
  failures: string[],
): Promise<void> {
  const token = process.env.LORE_INGEST_TOKEN;

  if (!token) {
    failures.push(
      "`LORE_INGEST_TOKEN` is not configured on the Floor — set the repo secret manually, or every ingest call will be rejected with 401",
    );

    return;
  }
  await project.settings
    .setRepoSecret("LORE_INGEST_TOKEN", token)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_TOKEN\` repo secret could not be set: ${errorMessage(err)}`,
      ),
    );
}

/** Where a committed file is recorded: the list the PR body reports, and the failures it reports alongside them. */
interface OnboardLedger {
  kind: string;
  committed: string[];
  failures: StepFailure[];
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
    const alreadyThere =
      existingFiles.has(sf.path) || existingFiles.has(sf.path.split("/")[0]);

    if (alreadyThere) {
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

/** Everything one generated file needs: where to commit it and what task it belongs to. */
interface OnboardGenerationContext {
  project: Awaited<ReturnType<typeof projectFor>>;
  branchName: string;
  contextStr: string;
  task: TaskHandlerInput["task"];
  model: TaskHandlerInput["model"];
}

/** Generate and commit one planned file. A generation failure is recorded, not thrown — the task fails only when nothing came through at all. */
async function generateAndCommitOneFile(
  ctx: OnboardGenerationContext,
  file: { path: string; prompt: string },
  ledger: { committed: string[]; failures: StepFailure[] },
): Promise<void> {
  try {
    const result = await Llm.instance.complete({
      prompt: `${file.prompt}\n\n## Repository Context\n\n${ctx.contextStr}`,
      systemPrompt: `Generate the content for ${file.path}. Output ONLY the file content — no explanation, no markdown code fences, no preamble. Start directly with the file content.`,
      model: ctx.model,
      maxTokens: 8192,
      taskId: ctx.task.id,
    });

    const text = result.text.trim();
    const modelSkipped = text === "SKIP" || text.length < 20;

    if (modelSkipped) {
      console.log(
        `[floor] Onboard: skipping ${file.path} (model returned SKIP)`,
      );

      return;
    }

    await ctx.project.repo.commitFile(
      ctx.branchName,
      file.path,
      text,
      `lore: add ${file.path}`,
    );
    ledger.committed.push(file.path);
    console.log(
      `[floor] Onboard: committed ${file.path} (${text.length} chars)`,
    );
  } catch (err) {
    console.error(
      `[floor] Onboard: failed to generate ${file.path}: ${errorMessage(err)}`,
    );
    ledger.failures.push({ step: file.path, error: errorMessage(err) });
  }
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

/** Ingest-callback configuration is fail-soft; only the log line differs on success vs. partial failure. */
function logIngestConfigResult(
  targetRepo: string,
  configFailures: string[],
): void {
  if (configFailures.length === 0) {
    console.log(`[floor] Configured ingest secrets on ${targetRepo}`);

    return;
  }
  console.error(
    `[floor] Ingest config incomplete on ${targetRepo}: ${configFailures.join("; ")}`,
  );
}

/** What an onboard-failure audit entry needs; grouped because `handleOnboard` already tracked every field before deciding whether to write one. */
interface OnboardFailureAudit {
  task: TaskHandlerInput["task"];
  targetRepo: string;
  failures: StepFailure[];
  configFailures: string[];
  workflowsPermissionDenied: boolean;
}

/** Records a failed-files audit entry only when there was something to report. */
async function auditOnboardFailuresIfAny(
  audit: OnboardFailureAudit,
): Promise<void> {
  const {
    task,
    targetRepo,
    failures,
    configFailures,
    workflowsPermissionDenied,
  } = audit;

  if (failures.length === 0 && configFailures.length === 0) {
    return;
  }

  await writeAuditLog({
    event_type: "onboard_files_failed",
    task_id: task.id,
    repo: targetRepo,
    payload: {
      failed_files: failures.map((f) => ({ path: f.step, error: f.error })),
      config_failures: configFailures,
      workflows_permission_denied: workflowsPermissionDenied,
    },
  }).catch((err) =>
    console.warn(`[floor] Onboard: audit write failed: ${errorMessage(err)}`),
  );
}

/** Best-effort dispatch-label setup; a failure here doesn't block onboarding. */
async function createDispatchLabels(
  project: Awaited<ReturnType<typeof projectFor>>,
  targetRepo: string,
): Promise<void> {
  try {
    await project.issues.createLabels([
      { name: "lore", color: "7B61FF", description: "Dispatch to Lore agent" },
      ...DISPATCH_LABELS.map(({ name, color, description }) => ({
        name,
        color,
        description,
      })),
      ...BACKLOG_LABEL_SEED,
    ]);
    console.log(`[floor] Created Lore dispatch labels on ${targetRepo}`);
  } catch (err) {
    console.warn(
      `[floor] Failed to create labels on ${targetRepo}: ${(err as Error).message}`,
    );
  }
}

export async function handleOnboard({
  task,
  targetRepo,
  branchName,
  model,
  issueNumber,
}: TaskHandlerInput): Promise<void> {
  const project = await projectFor(targetRepo);

  // 1. Pre-fetch repo context
  console.log(`[floor] Onboard: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);
  const contextStr = JSON.stringify(context, null, 2);

  console.log(
    `[floor] Onboard: ${context.tree.length} tree entries, ${Object.keys(context.files).length} files`,
  );

  // 2. Determine which files already exist
  const existingFiles = new Set([
    ...context.tree,
    ...Object.keys(context.files),
  ]);

  // Check subdirectories
  const hasAdrs =
    context.tree.includes("adrs") || context.tree.includes("docs");

  const toGenerate = await planOnboardFiles(targetRepo, {
    existingFiles,
    hasAdrs,
  });

  enforceTrue(
    toGenerate.length !== 0,
    Error,
    "All onboarding files already exist — nothing to generate",
  );

  console.log(`[floor] Onboard: generating ${toGenerate.length} files...`);

  // 4. Create branch
  await project.repo.createBranch(branchName);

  const committed: string[] = [];
  const failures: StepFailure[] = [];

  await commitWorkflowFiles(project, branchName, committed, failures);
  await commitMissingStaticFiles(project, branchName, existingFiles, {
    committed,
    failures,
  });
  await generateAndCommitFiles(
    { project, branchName, contextStr, task, model },
    toGenerate,
    { committed, failures },
  );

  if (committed.length === 0) {
    const { summary, details } = summarizeFailures(failures);

    throw new TaskFailure(
      summary
        ? `Failed to generate any onboarding files — ${summary}`
        : "Failed to generate any onboarding files",
      details,
    );
  }

  // Configure ingest callback before opening PR so failures can be reported; never write empty vars
  const configFailures = await configureIngestCallback(project);

  logIngestConfigResult(targetRepo, configFailures);

  const workflowsPermissionDenied = anyWorkflowsPermissionFailure(failures);

  await auditOnboardFailuresIfAny({
    task,
    targetRepo,
    failures,
    configFailures,
    workflowsPermissionDenied,
  });

  // 6. Create PR
  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const attention = onboardAttentionSection(
    failures,
    configFailures,
    workflowsPermissionDenied,
  );
  const pr = await project.pulls.open(branchName, {
    title: `lore: onboard ${targetRepo}`,
    body: `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}${attention ? `\n${attention}` : ""}\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber, task.id)}`,
    base: await project.repo.defaultBranch(),
    labels: ["lore-onboarding"],
  });

  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  // Update lore.repos with the PR URL
  await settings().setOnboardingPrUrl(targetRepo, pr.url);

  await createDispatchLabels(project, targetRepo);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });

  // Auto-capture onboarding as episode
  writeEpisode(
    { memory: memoryLifecycle() },
    {
      content: `Repo ${targetRepo} onboarded\nGenerated: ${committed.join(", ")}\nPR: ${pr.url}`,
      source: "ci",
      ref: `${targetRepo}/${task.id}`,
    },
  ).catch(() => {});

  console.log(
    `[floor] Task ${task.id} → PR ${pr.url} (${committed.length} files)`,
  );
}
