/**
 * Core task processing worker.
 *
 * Polls pipeline.tasks for pending work, dispatches to the LLM,
 * and creates branches + PRs with the results.
 */

import { query } from "./db.js";
import { callLLM } from "./anthropic.js";
import { extractOnboardFiles } from "./output.js";
import {
  createBranch,
  commitFile,
  createPR,
  isConfigured,
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
    let systemPrompt: string | undefined;

    if (task.task_type === "onboard") {
      // Fetch repo context and append to prompt
      const context = await fetchRepoContext(task.target_repo);
      fullPrompt += `\n\n## Repository Context\n\n${JSON.stringify(context, null, 2)}`;
      systemPrompt =
        "You are onboarding a repository. Your ENTIRE response must be a single valid JSON object with a 'files' key. Do NOT include any text before or after the JSON. Each file value is the full file content as a string.";
    }

    // Resolve model
    const model =
      getTaskTypeConfig(task.task_type)?.model || undefined;

    // Call LLM
    const result = await callLLM({
      prompt: fullPrompt,
      systemPrompt,
      model,
      maxTokens: 16384,
      taskId: task.id,
    });

    // Determine target repo and branch
    const targetRepo = task.target_repo || "re-cinq/lore";
    const slug = slugify(task.description);
    const branchName = `lore/${task.task_type}/${slug}-${task.id.substring(0, 8)}`;

    if (!isConfigured()) {
      throw new Error("GitHub App not configured — cannot create PR");
    }

    if (task.task_type === "onboard") {
      await handleOnboardOutput(task, result.text, targetRepo, branchName);
    } else {
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

// ── Output handlers ───────────────────────────────────────────────────

async function handleOnboardOutput(
  task: any,
  text: string,
  targetRepo: string,
  branchName: string,
): Promise<void> {
  let parsed = extractOnboardFiles(text);

  // Retry once with a stricter prompt if parsing failed
  if (!parsed) {
    console.log(
      `[agent] First parse failed for task ${task.id}, retrying with strict prompt`,
    );
    const retry = await callLLM({
      prompt: `Respond with ONLY valid JSON: {"files": {"path": "content", ...}}. No other text.`,
      systemPrompt:
        'Respond with ONLY valid JSON: {"files": {"path": "content", ...}}. No other text.',
      model: getTaskTypeConfig(task.task_type)?.model || undefined,
      maxTokens: 16384,
      taskId: task.id,
    });
    parsed = extractOnboardFiles(retry.text);
  }

  if (parsed && Object.keys(parsed.files).length > 0) {
    // Multi-file commit
    await createBranch(targetRepo, branchName);

    for (const [filePath, content] of Object.entries(parsed.files)) {
      await commitFile(
        targetRepo,
        branchName,
        filePath,
        content,
        `lore: add ${filePath}`,
      );
    }

    const fileList = Object.keys(parsed.files)
      .map((f) => `- \`${f}\``)
      .join("\n");
    const pr = await createPR(
      targetRepo,
      branchName,
      `lore: onboard ${targetRepo}`,
      `## Onboarding\n\nFiles added:\n${fileList}\n\nGenerated by Lore agent task \`${task.id}\`.`,
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
  } else {
    // Fallback: commit raw output as single file
    console.log(
      `[agent] JSON parse failed twice for task ${task.id}, falling back to single file`,
    );
    await createBranch(targetRepo, branchName);
    const slug = slugify(task.description);
    const filePath = `output/${slug}.md`;
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
      `lore: onboard ${targetRepo}`,
      `## Onboarding (raw output)\n\nCould not parse structured output. Raw LLM response committed as \`${filePath}\`.\n\nGenerated by Lore agent task \`${task.id}\`.`,
    );

    await setStatus(task.id, "pr-created", {
      pr_url: pr.url,
      pr_number: pr.number,
      target_branch: branchName,
    });
    await insertEvent(task.id, "running", "pr-created", {
      pr_url: pr.url,
    });

    console.log(`[agent] Task ${task.id} → PR ${pr.url} (fallback)`);
  }
}

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
