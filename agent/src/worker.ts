/**
 * Core task processing worker.
 *
 * Polls pipeline.tasks for pending work, dispatches to the LLM,
 * and creates branches + PRs with the results.
 */

import { query } from "./db.js";
import { callLLM, callLLMWithTool } from "./anthropic.js";
import { platform } from "./platform.js";
import { fetchRepoContext } from "./repo-context.js";
import { buildPrompt, getTaskTypeConfig } from "./config.js";

// ── Helpers ───────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

// ── Status transition helpers ─────────────────────────────────────────

async function setStatus(
  taskId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const setClauses = ["status = $1", "updated_at = now()"];
  const params: unknown[] = [status];
  let idx = 2;

  for (const [key, value] of Object.entries(extra)) {
    setClauses.push(`${key} = $${idx}`);
    params.push(value);
    idx++;
  }
  params.push(taskId);

  await query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    params as any[],
  );
}

async function insertEvent(
  taskId: string,
  fromStatus: string,
  toStatus: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await query(
    `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
     VALUES ($1, $2, $3, $4)`,
    [taskId, fromStatus, toStatus, JSON.stringify(metadata)],
  );
}

// ── Crash recovery ────────────────────────────────────────────────────

/**
 * Reset tasks that have been stuck in running/queued for over 30 minutes
 * back to pending so they can be retried.
 */
export async function recoverStaleTasks(): Promise<number> {
  const stale = await query<{ id: string; task_type: string }>(
    `SELECT id, task_type FROM pipeline.tasks
     WHERE status IN ('running', 'queued')
       AND updated_at < now() - interval '30 minutes'`,
  );

  let recovered = 0;
  for (const row of stale) {
    // Don't reset implementation tasks — they run in ephemeral Job pods
    // managed by the LoreTask CRD. The loretask-watcher handles completion.
    if (row.task_type === "implementation") {
      console.log(
        `[agent] Skipping stale implementation task ${row.id} — managed by LoreTask CRD`,
      );
      continue;
    }
    await setStatus(row.id, "pending");
    await insertEvent(row.id, "running", "pending", {
      reason: "crash-recovery",
    });
    console.log(
      `[agent] Recovered stale task ${row.id} (${row.task_type}) → pending`,
    );
    recovered++;
  }

  return recovered;
}

// ── Worker loop ───────────────────────────────────────────────────────

/**
 * Start the polling worker. Polls every 10 seconds and processes one
 * task at a time.
 */
export async function startWorker(): Promise<void> {
  console.log("[agent] Worker started");
  setInterval(pollOnce, 10_000);
  await pollOnce();
}

async function pollOnce(): Promise<void> {
  // 30-second grace period: local runners claim tasks immediately,
  // so we only pick up tasks that have been pending long enough for
  // a local runner to claim first.  Also skip running-local tasks
  // (already claimed by a local runner).
  const task = await query<any>(
    `SELECT * FROM pipeline.tasks
     WHERE status = 'pending'
       AND status != 'running-local'
       AND created_at < now() - interval '30 seconds'
     ORDER BY created_at ASC
     LIMIT 1`,
  ).then((rows) => rows[0] ?? null);

  if (!task) return;

  await processTask(task);
}

// ── Task processing ───────────────────────────────────────────────────

async function processTask(task: any): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;
  const targetRepo = task.target_repo || "re-cinq/lore";

  // Create GitHub Issue on the target repo
  // Skip upfront issue for general tasks — the watcher creates the issue with the result
  let issueNumber: number | null = task.issue_number || null;
  if (!issueNumber && task.task_type !== "general") {
    try {
      const taskTypeLabel = task.task_type === "feature-request" ? "spec" : task.task_type;
      const issue = await platform().createIssue(
        targetRepo,
        `[lore] ${task.task_type}: ${task.description.substring(0, 80)}`,
        `## Lore Pipeline Task\n\n**Type:** \`${task.task_type}\`\n**Created by:** \`${task.created_by || "unknown"}\`\n**Task ID:** \`${task.id}\`\n\n---\n\n${task.description}\n\n---\n*This issue is managed by [Lore](https://github.com/re-cinq/lore). Status updates will be posted as comments.*`,
        ["lore-managed", taskTypeLabel],
      );
      issueNumber = issue.number;
      await query(
        `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
        [issue.number, issue.url, task.id],
      );
      console.log(`[agent] Created issue #${issue.number} on ${targetRepo}`);
    } catch (err: any) {
      // Non-fatal — proceed without issue if GitHub App lacks permission
    console.warn(`[agent] Could not create issue on ${targetRepo}: ${err.message}`);
    }
  } else if (issueNumber) {
    console.log(`[agent] Using existing issue #${issueNumber} on ${targetRepo} (webhook-dispatched)`);
  }

  // Check if this task requires approval
  const { requiresApproval, getApprovalLabel } = await import("./approval.js");
  if (requiresApproval(task.task_type, targetRepo)) {
    await setStatus(task.id, "awaiting_approval");
    await insertEvent(task.id, "pending", "awaiting_approval", { reason: "approval-required" });

    if (issueNumber) {
      await platform().commentOnIssue(targetRepo, issueNumber,
        `This task requires approval before the agent can proceed.\n\nAdd the \`${getApprovalLabel()}\` label to this issue to approve.`);
      await platform().addIssueLabel(targetRepo, issueNumber, "awaiting-approval");
    }

    console.log(`[agent] Task ${task.id} requires approval — waiting for label on issue #${issueNumber}`);
    return; // Don't process yet
  }

  // pending → queued
  await setStatus(task.id, "queued", { agent_id: agentId });
  await insertEvent(task.id, "pending", "queued");

  // queued → running
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");
  if (issueNumber) {
    await platform().commentOnIssue(targetRepo, issueNumber, `Agent \`${agentId}\` picked up this task.`).catch(() => {});
  }

  try {
    // Build prompt — context loading is handled by Claude Code in the Job pod
    // via the Lore workflow preamble (assemble_context + search_memory).
    // No server-side enrichment needed — avoids duplicate context and stale queries.
    const fullPrompt = buildPrompt(task.task_type, task.description);

    // Determine branch — use existing branch for revision tasks
    const contextBundle = task.context_bundle || {};
    const slug = slugify(task.description);
    const branchName = contextBundle.branch || `lore/${task.task_type}/${slug}-${task.id.substring(0, 8)}`;

    // If this is a revision task, prepend feedback to the description
    if (contextBundle.feedback) {
      task.description = `REVISION FEEDBACK: ${contextBundle.feedback}\n\nOriginal task: ${task.description}`;
    }

    if (!platform().isConfigured()) {
      throw new Error("GitHub App not configured — cannot create PR");
    }

    // Resolve model
    const model =
      getTaskTypeConfig(task.task_type)?.model || undefined;

    if (task.task_type === "onboard") {
      await handleOnboard(task, targetRepo, branchName, model, issueNumber);
    } else if (task.task_type === "feature-request") {
      await handleFeatureRequest(task, targetRepo, branchName, model, issueNumber);
    } else {
      // All other task types run as ephemeral Job pods via LoreTask CRD
      await handleClaudeCodeTask(task, targetRepo, branchName, model, issueNumber);
    }
  } catch (err: any) {
    await setStatus(task.id, "failed", {
      failure_reason: err.message,
    });
    await insertEvent(task.id, "running", "failed", {
      error: err.message,
    });
    // Update issue with failure
    if (issueNumber) {
      await platform().commentOnIssue(targetRepo, issueNumber, `Task failed: \`${err.message}\``).catch(() => {});
      await platform().addIssueLabel(targetRepo, issueNumber, "lore-failed").catch(() => {});
    }
    console.error(`[agent] Task ${task.id} failed: ${err.message}`);
  }
}

/**
 * After a PR is created, update the linked GitHub Issue with the PR reference.
 */
async function linkPrToIssue(
  repo: string,
  issueNumber: number | null,
  prUrl: string,
): Promise<void> {
  if (!issueNumber) return;
  try {
    await platform().commentOnIssue(repo, issueNumber, `PR created: ${prUrl}`);
  } catch { /* best effort */ }
}

/**
 * Get the issue reference suffix for PR bodies.
 */
function issueRef(issueNumber: number | null): string {
  return issueNumber ? `\n\nRefs #${issueNumber}` : "";
}

// ── Feature request handler ───────────────────────────────────────────

/**
 * Translates a PM's plain-language intent into a proper spec, data model,
 * and task breakdown — following the target repo's conventions.
 *
 * 1. Pre-fetches repo context (CLAUDE.md, existing specs, ADRs)
 * 2. Generates spec.md matching the repo's spec format
 * 3. Generates data-model.md if the feature involves data
 * 4. Generates an initial tasks.md breakdown
 * 5. Opens a PR with all artifacts for engineer review
 */
async function handleFeatureRequest(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  issueNumber: number | null,
): Promise<void> {
  console.log(`[agent] Feature request: fetching context for ${targetRepo}...`);
  const context = await fetchRepoContext(targetRepo);
  const contextStr = JSON.stringify(context, null, 2);

  // Also fetch existing specs as examples for format matching
  let existingSpecExample = "";
  try {
    const specs = await query(
      `SELECT content FROM org_shared.chunks WHERE repo = $1 AND content_type = 'spec' LIMIT 1`,
      [targetRepo],
    );
    if (specs.length > 0) {
      existingSpecExample = `\n\n## Existing Spec Example (match this format)\n\n${(specs[0] as any).content.substring(0, 3000)}`;
    }
  } catch { /* no specs in DB yet, that's fine */ }

  const pmIntent = task.description;
  const featureSlug = slugify(pmIntent);

  const SPEC_FILES = [
    {
      path: `specs/${featureSlug}/spec.md`,
      prompt: `Write a feature specification for the following product request.

The PM said: "${pmIntent}"

Write a proper engineering spec with these sections:
- Problem Statement (what problem does this solve for users?)
- Vision (what does the end state look like?)
- User Scenarios & Acceptance Criteria (concrete flows with testable criteria)
- Functional Requirements (numbered, testable)
- Non-Functional Requirements (performance, security if relevant)
- Out of Scope (what this does NOT include)
- Key Entities (data model implications)
- Success Criteria (measurable outcomes)
- Assumptions

Match the conventions and style of this repository. Be specific to the actual tech stack and architecture described in CLAUDE.md.${existingSpecExample}`,
    },
    {
      path: `specs/${featureSlug}/data-model.md`,
      prompt: `Based on this feature request, define the data model changes needed.

The PM said: "${pmIntent}"

If the feature requires new tables, fields, or relationships, document them with:
- Table name, fields, types, constraints
- Relationships to existing entities
- Migration notes

If no data model changes are needed, respond with just "SKIP".

Look at the existing schema in CLAUDE.md and any existing data models for conventions.`,
    },
    {
      path: `specs/${featureSlug}/tasks.md`,
      prompt: `Create a task breakdown for implementing this feature.

The PM said: "${pmIntent}"

Generate tasks in checklist format:
- [ ] T001 [P] Description with file path
- [ ] T002 Description with file path

Organize into phases:
- Phase 1: Setup (project scaffolding, dependencies)
- Phase 2: Core (main implementation)
- Phase 3: Integration (wiring, testing, polish)

Mark parallelizable tasks with [P]. Include file paths based on the actual project structure visible in the repo context. Each task must be specific enough for an engineer (or AI agent) to execute without additional context.`,
    },
  ];

  console.log(`[agent] Feature request: generating ${SPEC_FILES.length} artifacts for "${featureSlug}"...`);

  await platform().createBranch(targetRepo, branchName);

  const committed: string[] = [];
  for (const file of SPEC_FILES) {
    try {
      const result = await callLLM({
        prompt: `${file.prompt}\n\n## Repository Context\n\n${contextStr}`,
        systemPrompt: `Generate the content for ${file.path}. Output ONLY the file content — no explanation, no markdown code fences, no preamble. Start directly with the file content.`,
        model,
        maxTokens: 8192,
        taskId: task.id,
      });

      const text = result.text.trim();
      if (text === "SKIP" || text.length < 20) {
        console.log(`[agent] Feature request: skipping ${file.path} (not needed)`);
        continue;
      }

      await platform().commitFile(targetRepo, branchName, file.path, text, `lore: add ${file.path}`);
      committed.push(file.path);
      console.log(`[agent] Feature request: committed ${file.path} (${text.length} chars)`);
    } catch (err: any) {
      console.error(`[agent] Feature request: failed ${file.path}: ${err.message}`);
    }
  }

  if (committed.length === 0) {
    throw new Error("Failed to generate any spec artifacts");
  }

  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const pr = await platform().createPR(
    targetRepo,
    branchName,
    `spec: ${featureSlug}`,
    `## Feature Request → Spec\n\n**PM intent:** ${pmIntent}\n\n**Generated artifacts:**\n${fileList}\n\nThis spec was generated from a plain-language feature request. Engineers should review, refine, and merge before implementation.\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber)}`,
    "main",
    ["spec", "needs-review"],
  );
  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", { pr_url: pr.url });
  console.log(`[agent] Task ${task.id} → PR ${pr.url} (${committed.length} spec artifacts)`);
}

// ── LoreTask CR handler ─────────────────────────────────────────────

/**
 * Handle complex tasks (implementation, refactoring) by creating a
 * LoreTask custom resource on the cluster. The loretask-controller
 * provisions an ephemeral Job with Claude Code inside. When the Job
 * completes, the loretask-watcher job picks up the result and creates
 * a PR.
 */
async function handleClaudeCodeTask(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  _issueNumber: number | null,
): Promise<void> {
  const { KubeConfig, CustomObjectsApi } = await import("@kubernetes/client-node");
  const kc = new KubeConfig();
  kc.loadFromCluster();
  const k8sApi = kc.makeApiClient(CustomObjectsApi);

  const namespace = process.env.NAMESPACE || "lore-agent";
  const fullPrompt = buildPrompt(task.task_type, task.description);
  const crName = `loretask-${task.id.substring(0, 8)}`;

  const cr = {
    apiVersion: "lore.re-cinq.com/v1alpha1",
    kind: "LoreTask",
    metadata: {
      name: crName,
      namespace,
      labels: {
        "lore.re-cinq.com/task-id": task.id,
        "lore.re-cinq.com/task-type": task.task_type,
      },
    },
    spec: {
      taskId: task.id,
      taskType: task.task_type,
      description: task.description,
      prompt: fullPrompt,
      targetRepo,
      branch: branchName,
      model: model || "claude-sonnet-4-6",
      timeoutMinutes: getTaskTypeConfig(task.task_type)?.timeout_minutes || 30,
    },
  };

  try {
    await k8sApi.createNamespacedCustomObject({
      group: "lore.re-cinq.com",
      version: "v1alpha1",
      namespace,
      plural: "loretasks",
      body: cr,
    });
    console.log(`[agent] Created LoreTask CR ${crName} for task ${task.id}`);
  } catch (err: any) {
    const is409 = err?.code === 409 || err?.response?.statusCode === 409 || String(err?.message).includes("already exists");
    if (is409) {
      // CR already exists — watcher or another process created it. That's fine.
      console.log(`[agent] LoreTask CR ${crName} already exists, skipping`);
    } else {
      throw err;
    }
  }
  // Don't set pr-created — the loretask-watcher will do that when the Job completes
}

// ── Onboard handler (per-file LLM calls) ─────────────────────────────

/** Files that the onboard process can generate. */
/** Static files that don't need LLM generation */
const ONBOARD_STATIC_FILES: { path: string; content: string }[] = [
  {
    path: ".claude/settings.json",
    content: JSON.stringify({
      systemPromptSuffix: "\n\nYou have access to the Lore MCP server. ALWAYS call get_context as your FIRST action before reading files or answering. Then use search_memory to check what other developers learned. Before session ends, call write_memory with a session summary.",
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

/** ADR files are generated dynamically based on what's in the repo. */
const ADR_TOPICS = [
  { slug: "language-choice", prompt: "Write an ADR for the language/framework choice. Look at package.json, go.mod, Cargo.toml, etc. to determine what was chosen and why it makes sense for this project." },
  { slug: "database-choice", prompt: "Write an ADR for the database choice. Look at config files, schema definitions, docker-compose for DB services. If no database is evident, skip this ADR entirely and respond with just 'SKIP'." },
  { slug: "deployment", prompt: "Write an ADR for the deployment approach. Look at Dockerfile, CI workflows, Kubernetes manifests, serverless configs. Describe what was chosen and why." },
];

async function handleOnboard(
  task: any,
  targetRepo: string,
  branchName: string,
  model: string | undefined,
  issueNumber: number | null,
): Promise<void> {
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
  await platform().createBranch(targetRepo, branchName);

  // 5. Commit static files first
  const committed: string[] = [];
  for (const sf of ONBOARD_STATIC_FILES) {
    if (!existingFiles.has(sf.path) && !existingFiles.has(sf.path.split("/")[0])) {
      try {
        await platform().commitFile(targetRepo, branchName, sf.path, sf.content, `lore: add ${sf.path}`);
        committed.push(sf.path);
        console.log(`[agent] Onboard: committed ${sf.path} (static)`);
      } catch (err: any) {
        console.error(`[agent] Onboard: failed ${sf.path}: ${err.message}`);
      }
    }
  }

  // 6. Generate and commit LLM files
  for (const file of toGenerate) {
    try {
      const result = await callLLM({
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

      await platform().commitFile(targetRepo, branchName, file.path, text, `lore: add ${file.path}`);
      committed.push(file.path);
      console.log(`[agent] Onboard: committed ${file.path} (${text.length} chars)`);
    } catch (err: any) {
      console.error(`[agent] Onboard: failed to generate ${file.path}: ${err.message}`);
      // Continue with other files — don't fail the whole task
    }
  }

  if (committed.length === 0) {
    throw new Error("Failed to generate any onboarding files");
  }

  // 6. Create PR
  const fileList = committed.map((f) => `- \`${f}\``).join("\n");
  const pr = await platform().createPR(
    targetRepo,
    branchName,
    `lore: onboard ${targetRepo}`,
    `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber)}`,
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
    const { GitHubPlatform } = await import("./github.js");
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
    await platform().setRepoVariable(targetRepo, "LORE_INGEST_URL", ingestUrl);
    if (ingestToken) {
      await platform().setRepoSecret(targetRepo, "LORE_INGEST_TOKEN", ingestToken);
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
  console.log(`[agent] Task ${task.id} → PR ${pr.url} (${committed.length} files)`);
}

// ── Output handlers ───────────────────────────────────────────────────

async function handleGenericOutput(
  task: any,
  text: string,
  targetRepo: string,
  branchName: string,
  slug: string,
  issueNumber: number | null,
): Promise<void> {
  // Determine output file path based on task type
  let filePath: string;
  switch (task.task_type) {
    case "runbook":
      filePath = `runbooks/${slug}.md`;
      break;
    case "implementation":
      filePath = `src/${slug}.ts`;
      break;
    default:
      filePath = `output/${slug}.md`;
      break;
  }

  await platform().createBranch(targetRepo, branchName);
  await platform().commitFile(
    targetRepo,
    branchName,
    filePath,
    text,
    `lore: add ${filePath}`,
  );

  const pr = await platform().createPR(
    targetRepo,
    branchName,
    `lore: ${task.task_type} — ${slug}`,
    `## ${task.task_type}\n\n${task.description}\n\nOutput: \`${filePath}\`\n\nGenerated by Lore agent task \`${task.id}\`.${issueRef(issueNumber)}`,
  );
  await linkPrToIssue(targetRepo, issueNumber, pr.url);

  await setStatus(task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: branchName,
  });
  await insertEvent(task.id, "running", "pr-created", {
    pr_url: pr.url,
  });

  console.log(`[agent] Task ${task.id} → PR ${pr.url}`);
}
