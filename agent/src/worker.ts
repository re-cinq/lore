/**
 * Core task processing worker.
 *
 * Polls pipeline.tasks for pending work, dispatches to the LLM,
 * and creates branches + PRs with the results.
 */

import { query } from "./db.js";
import { callLLM, callLLMWithTool } from "./anthropic.js";
import {
  createBranch,
  commitFile,
  createPR,
  isConfigured,
  setRepoVariable,
  setRepoSecret,
} from "./github.js";
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

  for (const row of stale) {
    await setStatus(row.id, "pending");
    await insertEvent(row.id, "running", "pending", {
      reason: "crash-recovery",
    });
    console.log(
      `[agent] Recovered stale task ${row.id} (${row.task_type}) → pending`,
    );
  }

  return stale.length;
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
  const task = await query<any>(
    `SELECT * FROM pipeline.tasks
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`,
  ).then((rows) => rows[0] ?? null);

  if (!task) return;

  await processTask(task);
}

// ── Task processing ───────────────────────────────────────────────────

async function processTask(task: any): Promise<void> {
  const agentId = `lore-agent-${task.id.substring(0, 8)}`;

  // pending → queued
  await setStatus(task.id, "queued", { agent_id: agentId });
  await insertEvent(task.id, "pending", "queued");

  // queued → running
  await setStatus(task.id, "running");
  await insertEvent(task.id, "queued", "running");

  try {
    // Build prompt
    let fullPrompt = buildPrompt(task.task_type, task.description);

    // Determine target repo and branch
    const targetRepo = task.target_repo || "re-cinq/lore";
    const slug = slugify(task.description);
    const branchName = `lore/${task.task_type}/${slug}-${task.id.substring(0, 8)}`;

    if (!isConfigured()) {
      throw new Error("GitHub App not configured — cannot create PR");
    }

    // Resolve model
    const model =
      getTaskTypeConfig(task.task_type)?.model || undefined;

    if (task.task_type === "onboard") {
      await handleOnboard(task, targetRepo, branchName, model);
    } else {
      // Non-onboard task types
      const result = await callLLM({
        prompt: fullPrompt,
        model,
        maxTokens: 16384,
        taskId: task.id,
      });

      await handleGenericOutput(
        task,
        result.text,
        targetRepo,
        branchName,
        slug,
      );
    }
  } catch (err: any) {
    await setStatus(task.id, "failed", {
      failure_reason: err.message,
    });
    await insertEvent(task.id, "running", "failed", {
      error: err.message,
    });
    console.error(`[agent] Task ${task.id} failed: ${err.message}`);
  }
}

// ── Onboard handler (per-file LLM calls) ─────────────────────────────

/** Files that the onboard process can generate. */
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
  await createBranch(targetRepo, branchName);

  // 5. Generate and commit each file
  const committed: string[] = [];
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

      await commitFile(targetRepo, branchName, file.path, text, `lore: add ${file.path}`);
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
  const pr = await createPR(
    targetRepo,
    branchName,
    `lore: onboard ${targetRepo}`,
    `## Lore Onboarding\n\nThis PR adds Lore platform files for AI-powered development.\n\n**Files added:**\n${fileList}\n\nGenerated by Lore agent task \`${task.id}\`.`,
    "main",
    ["lore-onboarding"],
  );

  // Update lore.repos with the PR URL
  await query(
    `UPDATE lore.repos SET onboarding_pr_url = $1 WHERE full_name = $2`,
    [pr.url, targetRepo],
  );

  // Configure ingest secrets on the repo so lore-ingest.yml can call back
  const ingestUrl = process.env.LORE_INGEST_URL || "https://lore-api.gcp.re-cinq.com";
  const ingestToken = process.env.LORE_INGEST_TOKEN;
  try {
    await setRepoVariable(targetRepo, "LORE_INGEST_URL", ingestUrl);
    if (ingestToken) {
      await setRepoSecret(targetRepo, "LORE_INGEST_TOKEN", ingestToken);
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

  await createBranch(targetRepo, branchName);
  await commitFile(
    targetRepo,
    branchName,
    filePath,
    text,
    `lore: add ${filePath}`,
  );

  const pr = await createPR(
    targetRepo,
    branchName,
    `lore: ${task.task_type} — ${slug}`,
    `## ${task.task_type}\n\n${task.description}\n\nOutput: \`${filePath}\`\n\nGenerated by Lore agent task \`${task.id}\`.`,
  );

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
