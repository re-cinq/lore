/**
 * Onboard handler (per-file LLM calls).
 *
 * Inspects a repo and generates Lore platform files (CLAUDE.md, AGENTS.md,
 * ADRs, spec, CI workflows, test-command manifest) in an onboarding PR.
 */

import { query } from "../../data/db.js";
import { Llm } from "@re-cinq/lore-shared";
import { projectFor } from "../../ports/project-boot.js";
import { fetchRepoContext } from "./repo-context.js";
import { writeEpisode } from "../../adapters/episode-writer.js";
import {
  summarizeFailures,
  TaskFailure,
  type StepFailure,
} from "@re-cinq/lore-shared";
import { LORE_INGEST_WORKFLOW_PATH, LORE_INGEST_WORKFLOW_CONTENT, TRACE_IMPACT_WORKFLOW_PATH, TRACE_IMPACT_WORKFLOW_CONTENT, LORE_TESTS_INSTRUCTION, decideTestInterfaceCheck } from "@re-cinq/lore-shared";
import { setStatus, insertEvent, issueRef, linkPrToIssue } from "./task-helpers.js";

// ── Onboard handler (per-file LLM calls) ─────────────────────────────

/** Files that the onboard process can generate. */
/** Static files that don't need LLM generation */
const ONBOARD_STATIC_FILES: { path: string; content: string }[] = [
  {
    path: ".claude/settings.json",
    content: JSON.stringify({
      systemPromptSuffix: "\n\nYou have access to the Lore MCP server. ALWAYS call get_context as your FIRST action before reading files or answering. Then use lore_search_memory to check what other developers learned. Before session ends, call lore_write_memory with a session summary.",
    }, null, 2),
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

const ONBOARD_FILES: { path: string; description: string; prompt: string }[] = [
  {
    path: "AGENTS.md",
    description: "Agent configuration for AI tools",
    prompt: "Generate an AGENTS.md file for this repository. Include: context loading order (which files agents should read first), workflow commands (build, test, lint, deploy), commit conventions, PR requirements, and compliance constraints if any. Be specific to this repo's actual tech stack and structure.",
  },
  {
    path: ".github/PULL_REQUEST_TEMPLATE.md",
    description: "PR description template",
    prompt: "Generate a GitHub PR template. Include sections: ## Why, ## What Changed, ## Alternatives Considered, ## ADRs & Architecture, ## Testing. Add a checklist for code quality (lint, types, tests, no secrets).",
  },
  {
    path: ".github/workflows/pr-description-check.yml",
    description: "CI check for PR description quality",
    prompt: 'Generate a GitHub Actions workflow that checks PR descriptions have required sections (## Why, ## What Changed, ## Testing). Use the github.event.pull_request.body context. Run on pull_request opened/edited. Fail if sections are missing.',
  },
  {
    path: ".specify/spec.md",
    description: "System specification",
    prompt: "Generate a system specification describing what this repository does based on the code structure, README, and config files. Include: overview, key capabilities, core data model (if applicable), user roles, business rules, and success metrics. Describe the system as it exists today.",
  },
];

/**
 * Onboard scaffold prompt for the suggested `.lore/test-commands.yml` manifest
 * (project-test-interface AC12). Language-agnostic — the agent detects the real
 * runner. The team reviews and adjusts the suggestion in the onboarding PR.
 */
const TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT =
  "Generate a suggested `.lore/test-commands.yml` test-command manifest for this repository. Detect the actual test framework and coverage tooling from the repo's build files and config — never assume a runner. Declare three keys: `list` (a shell command that prints to stdout a JSON array of test descriptors `{id, name, file, startLine, endLine, spec?}`, where `id` is the framework's native, stable test node id), `run` (a shell command containing the literal `{selector}` placeholder that runs the single test named by that id with coverage and prints `{passed, covered:[{file, startLine, endLine}]}` or emits an lcov/cobertura report), and `coverage_format` (one of lcov | cobertura | json). For a monorepo, emit a top-level list with one entry per package, each carrying its own `cwd`. This is a suggested scaffold the team reviews and adjusts — do not change any test behaviour.";

/** ADR files are generated dynamically based on what's in the repo. */
const ADR_TOPICS = [
  { slug: "language-choice", prompt: "Write an ADR for the language/framework choice. Look at package.json, go.mod, Cargo.toml, etc. to determine what was chosen and why it makes sense for this project." },
  { slug: "database-choice", prompt: "Write an ADR for the database choice. Look at config files, schema definitions, docker-compose for DB services. If no database is evident, skip this ADR entirely and respond with just 'SKIP'." },
  { slug: "deployment", prompt: "Write an ADR for the deployment approach. Look at Dockerfile, CI workflows, Kubernetes manifests, serverless configs. Describe what was chosen and why." },
];

export async function handleOnboard(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  issueNumber: number | null,
): Promise<void> {
  const project = await projectFor(targetRepo);
  // 1. Pre-fetch repo context
  console.log(`[agent] Onboard: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);
  const contextStr = JSON.stringify(context, null, 2);
  console.log(`[agent] Onboard: ${context.tree.length} tree entries, ${Object.keys(context.files).length} files`);

  // 2. Determine which files already exist
  const existingFiles = new Set([
    ...context.tree,
    ...Object.keys(context.files),
  ]);

  // Check subdirectories
  const hasAdrs = context.tree.includes("adrs") || context.tree.includes("docs");
  const hasGithub = context.tree.includes(".github");

  // 3. Build list of files to generate
  const toGenerate: { path: string; prompt: string }[] = [];

  for (const f of ONBOARD_FILES) {
    if (existingFiles.has(f.path) || existingFiles.has(f.path.split("/").pop()!)) {
      console.log(`[agent] Onboard: skipping ${f.path} (already exists)`);
      continue;
    }
    toGenerate.push({ path: f.path, prompt: f.prompt });
  }

  // Test-interface check (project-test-interface AC12): when the repo declares
  // NO test-command manifest (neither a .lore/test-commands.yml file nor
  // lore.repos.settings.test_commands), scaffold the suggested manifest +
  // per-toolchain lore-tests.yml in the onboarding PR. A repo that already
  // declares one is reported "configured" and scaffolds nothing (idempotent).
  // Declining (not merging the scaffold) leaves the repo in documented fallback
  // mode with no error — the scaffold is a suggestion, never enforced.
  let settingsTestCommands: unknown;
  try {
    const rows = await query<{ settings: any }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [targetRepo],
    );
    settingsTestCommands = rows[0]?.settings?.test_commands;
  } catch (err: any) {
    console.warn(`[agent] Onboard: could not read repo settings for test-interface check: ${err.message}`);
  }
  const interfaceCheck = decideTestInterfaceCheck({
    manifestFileDeclared: existingFiles.has(".lore/test-commands.yml"),
    settingsTestCommands,
  });
  if (interfaceCheck.status === "configured") {
    console.log("[agent] Onboard: test interface already configured — scaffolding nothing");
  } else {
    for (const scaffoldPath of interfaceCheck.files) {
      if (existingFiles.has(scaffoldPath)) continue;
      toGenerate.push({
        path: scaffoldPath,
        prompt: scaffoldPath === ".github/workflows/lore-tests.yml"
          ? LORE_TESTS_INSTRUCTION
          : TEST_COMMAND_MANIFEST_SCAFFOLD_PROMPT,
      });
    }
  }

  // ADRs: generate if no adrs/ directory exists
  if (!hasAdrs) {
    let adrNum = 1;
    for (const adr of ADR_TOPICS) {
      const padded = String(adrNum).padStart(3, "0");
      toGenerate.push({
        path: `adrs/ADR-${padded}-${adr.slug}.md`,
        prompt: adr.prompt + ` Use MADR format with YAML frontmatter (adr_number: ${adrNum}, title, status: accepted, date: ${new Date().toISOString().split("T")[0]}, domains: [...]).`,
      });
      adrNum++;
    }
  } else {
    console.log(`[agent] Onboard: skipping ADRs (adrs/ or docs/ already exists)`);
  }

  if (toGenerate.length === 0) {
    throw new Error("All onboarding files already exist — nothing to generate");
  }

  console.log(`[agent] Onboard: generating ${toGenerate.length} files...`);

  // 4. Create branch
  await project.repo.createBranch(branchName);

  const committed: string[] = [];
  const failures: StepFailure[] = [];

  // Always (re)install the ingest workflow. commitFile upserts, and the
  // coarse static-file skip below would wrongly skip it on any repo that
  // already has a .github directory — which is most of them.
  try {
    await project.repo.commitFile(
      branchName,
      LORE_INGEST_WORKFLOW_PATH,
      LORE_INGEST_WORKFLOW_CONTENT,
      `lore: add ${LORE_INGEST_WORKFLOW_PATH}`,
    );
    committed.push(LORE_INGEST_WORKFLOW_PATH);
    console.log(`[agent] Onboard: committed ${LORE_INGEST_WORKFLOW_PATH} (workflow)`);
  } catch (err: any) {
    console.error(`[agent] Onboard: failed ${LORE_INGEST_WORKFLOW_PATH}: ${err.message}`);
    failures.push({ step: LORE_INGEST_WORKFLOW_PATH, error: err.message });
  }

  // Always (re)install the advisory spec-impact workflow alongside ingest. It is
  // neutral/fail-soft (no-ops until the backend graph is available), so it is
  // safe to ship to every onboarded repo.
  try {
    await project.repo.commitFile(
      branchName,
      TRACE_IMPACT_WORKFLOW_PATH,
      TRACE_IMPACT_WORKFLOW_CONTENT,
      `lore: add ${TRACE_IMPACT_WORKFLOW_PATH}`,
    );
    committed.push(TRACE_IMPACT_WORKFLOW_PATH);
    console.log(`[agent] Onboard: committed ${TRACE_IMPACT_WORKFLOW_PATH} (workflow)`);
  } catch (err: any) {
    console.error(`[agent] Onboard: failed ${TRACE_IMPACT_WORKFLOW_PATH}: ${err.message}`);
    failures.push({ step: TRACE_IMPACT_WORKFLOW_PATH, error: err.message });
  }

  // 5. Commit static files first
  for (const sf of ONBOARD_STATIC_FILES) {
    if (!existingFiles.has(sf.path) && !existingFiles.has(sf.path.split("/")[0])) {
      try {
        await project.repo.commitFile(branchName, sf.path, sf.content, `lore: add ${sf.path}`);
        committed.push(sf.path);
        console.log(`[agent] Onboard: committed ${sf.path} (static)`);
      } catch (err: any) {
        console.error(`[agent] Onboard: failed ${sf.path}: ${err.message}`);
        failures.push({ step: sf.path, error: err.message });
      }
    }
  }

  // 6. Generate and commit LLM files
  for (const file of toGenerate) {
    try {
      const result = await Llm.instance.complete({
        prompt: `${file.prompt}\n\n## Repository Context\n\n${contextStr}`,
        systemPrompt: `Generate the content for ${file.path}. Output ONLY the file content — no explanation, no markdown code fences, no preamble. Start directly with the file content.`,
        model,
        maxTokens: 8192,
        taskId: task.id,
      });

      // Skip if model says to skip (e.g., no database detected)
      const text = result.text.trim();
      if (text === "SKIP" || text.length < 20) {
        console.log(`[agent] Onboard: skipping ${file.path} (model returned SKIP)`);
        continue;
      }

      await project.repo.commitFile(branchName, file.path, text, `lore: add ${file.path}`);
      committed.push(file.path);
      console.log(`[agent] Onboard: committed ${file.path} (${text.length} chars)`);
    } catch (err: any) {
      console.error(`[agent] Onboard: failed to generate ${file.path}: ${err.message}`);
      failures.push({ step: file.path, error: err.message });
      // Continue with other files — don't fail the whole task
    }
  }

  if (committed.length === 0) {
    const { summary, details } = summarizeFailures(failures);
    throw new TaskFailure(
      summary
        ? `Failed to generate any onboarding files — ${summary}`
        : "Failed to generate any onboarding files",
      details,
    );
  }

  // 6. Create PR
  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const pr = await project.pulls.open(
    branchName,
    `lore: onboard ${targetRepo}`,
    `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber, task.id)}`,
    "main",
    ["lore-onboarding"],
  );
  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  // Update lore.repos with the PR URL
  await query(
    `UPDATE lore.repos SET onboarding_pr_url = $1 WHERE full_name = $2`,
    [pr.url, targetRepo],
  );

  // Create Lore dispatch labels on the repo
  try {
    const { GitHubPlatform } = await import("../../adapters/github.js");
    const gh = new GitHubPlatform();
    await gh.createLabels(targetRepo, [
      { name: "lore", color: "7B61FF", description: "Dispatch to Lore agent" },
      { name: "lore:implementation", color: "0E8A16", description: "Lore: implementation task" },
      { name: "lore:review", color: "1D76DB", description: "Lore: review task" },
      { name: "lore:runbook", color: "D93F0B", description: "Lore: runbook task" },
    ]);
    console.log(`[agent] Created Lore dispatch labels on ${targetRepo}`);
  } catch (err: any) {
    console.warn(`[agent] Failed to create labels on ${targetRepo}: ${err.message}`);
  }

  // Configure ingest secrets on the repo so lore-ingest.yml can call back
  const ingestUrl = process.env.LORE_INGEST_URL || "";
  const ingestToken = process.env.LORE_INGEST_TOKEN;
  try {
    await project.settings.setRepoVariable("LORE_INGEST_URL", ingestUrl);
    if (ingestToken) {
      await project.settings.setRepoSecret("LORE_INGEST_TOKEN", ingestToken);
    }
    console.log(`[agent] Configured ingest secrets on ${targetRepo}`);
  } catch (err: any) {
    console.error(`[agent] Failed to set ingest secrets on ${targetRepo}: ${err.message}`);
    // Non-fatal — PR still created, secrets can be set manually
  }

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });

  // Auto-capture onboarding as episode
  writeEpisode(
    `Repo ${targetRepo} onboarded\nGenerated: ${committed.join(", ")}\nPR: ${pr.url}`,
    "ci",
    `${targetRepo}/${task.id}`,
  ).catch(() => {});

  console.log(`[agent] Task ${task.id} → PR ${pr.url} (${committed.length} files)`);
}
