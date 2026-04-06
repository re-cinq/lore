/**
 * Local Task Runner — manages local task execution via git worktrees
 * and background Claude Code processes.
 *
 * Spawns headless Claude Code in isolated worktrees so tasks run on the
 * developer's machine using their subscription (zero API cost).
 *
 * Phase 1: explicit execution via spawnLocalTask
 * Phase 2: task notifier (startNotifier / stopNotifier) + interactive claim
 */
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectTooling, runValidation, formatValidationOutput } from "./repo-validation.js";
import { redactSecrets } from "@re-cinq/lore-shared";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const LORE_DIR = path.join(os.homedir(), ".lore");
const WORKTREES_DIR = path.join(LORE_DIR, "worktrees");
const LOGS_DIR = path.join(LORE_DIR, "task-logs");
const TASKS_FILE = path.join(LORE_DIR, "local-tasks.json");
const PENDING_FILE = path.join(LORE_DIR, "pending-tasks.json");
const CONFIG_FILE = path.join(LORE_DIR, "local-runner.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalRunnerConfig {
  enabled: boolean;
  max_concurrent: number;
  repos: string[];
  task_types: string[];
  model: string;
}

export function readConfig(): LocalRunnerConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return { enabled: false, max_concurrent: 2, repos: [], task_types: ["implementation", "general", "runbook", "gap-fill"], model: "claude-sonnet-4-6" };
  }
}

export function writeConfig(config: LocalRunnerConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export interface LocalTask {
  taskId: string;
  pid: number;
  branch: string;
  repo: string;
  worktreePath: string;
  logFile: string;
  startedAt: string;
  status: "running" | "completed" | "failed";
  prUrl?: string;
  error?: string;
}

export interface LocalRunnerConfig {
  enabled: boolean;
  max_concurrent: number;
  repos: string[];
  task_types: string[];
  model: string;
}

export interface PendingTask {
  id: string;
  description: string;
  task_type: string;
  target_repo: string;
  created_at: string;
  issue_number?: number;
}

// ---------------------------------------------------------------------------
// Directory & file helpers
// ---------------------------------------------------------------------------

function ensureDirs(): void {
  for (const dir of [WORKTREES_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readTasks(): LocalTask[] {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeTasks(tasks: LocalTask[]): void {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// ---------------------------------------------------------------------------
// Slug / repo helpers (exported for MCP tools)
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 40)
    .replace(/-$/, "");
}

/** Returns the git repo root for the current working directory, or null. */
export function getRepoRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/** Detects the GitHub owner/repo from the current git remote. */
export function detectRepo(): string | null {
  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// API helpers (best-effort updates to GKE pipeline)
// ---------------------------------------------------------------------------

function getApiUrl(): string {
  // Prefer env var, fall back to git config
  if (process.env.LORE_API_URL) return process.env.LORE_API_URL;
  try {
    return execSync("git config --global lore.api-url", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function getToken(): string {
  if (process.env.LORE_INGEST_TOKEN) return process.env.LORE_INGEST_TOKEN;
  try {
    return execSync("git config --global lore.ingest-token", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

async function updateTaskViaAPI(
  taskId: string,
  status: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();
  if (!apiUrl || !token) return;

  try {
    await fetch(`${apiUrl}/api/task`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_id: taskId, status, ...metadata }),
    });
  } catch {
    // Best effort — don't crash if the API is unreachable
  }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** Waits for a process to exit by polling kill(pid, 0). */
async function waitForExit(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      try {
        process.kill(pid, 0); // 0 = check if alive, no signal sent
        setTimeout(check, 3000);
      } catch {
        resolve(); // Process no longer exists
      }
    };
    check();
  });
}

/** Returns true if the given PID is still running. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Monitor — runs in background after task spawn
// ---------------------------------------------------------------------------

async function monitorTask(task: LocalTask): Promise<void> {
  await waitForExit(task.pid);

  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.taskId === task.taskId);

  try {
    // Check for uncommitted changes in the worktree
    const status = execSync("git status --porcelain", {
      cwd: task.worktreePath,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();

    if (status) {
      // ── Deterministic validation (Minions-inspired) ──
      // Run lint/typecheck as mandatory pipeline stages before commit.
      const changedFiles = status.split("\n")
        .map((line) => line.substring(3).trim())
        .filter(Boolean);
      const tooling = detectTooling(task.worktreePath);

      if (tooling.quickChecks.length > 0) {
        console.log(`[lore] local-runner: running ${tooling.language} validation (${tooling.quickChecks.map((s) => s.name).join(", ")})`);
        const validation = runValidation(task.worktreePath, tooling.quickChecks, changedFiles);

        if (!validation.passed) {
          // Attempt one retry: spawn Claude Code with fix prompt
          const fixOutput = formatValidationOutput(validation);
          console.log(`[lore] local-runner: validation failed, attempting fix retry for ${task.taskId}`);
          fs.appendFileSync(task.logFile, `\n\n--- VALIDATION FAILED ---\n${fixOutput}\n`);

          const fixPrompt = [
            "Validation checks failed after your changes. Fix ONLY these errors.",
            "Do not re-implement the original task. Only fix the validation errors.",
            "",
            fixOutput,
          ].join("\n");

          const config = readConfig();
          const fixModel = config.model || "claude-sonnet-4-6";
          const fixLogFd = fs.openSync(task.logFile, "a");
          const fixChild = spawn(
            "claude",
            ["--print", "--dangerously-skip-permissions", "--model", fixModel, "--", fixPrompt],
            { cwd: task.worktreePath, detached: true, stdio: ["ignore", fixLogFd, fixLogFd], env: { ...process.env, HOME: os.homedir() } },
          );
          fixChild.unref();
          fs.closeSync(fixLogFd);

          if (fixChild.pid) {
            await waitForExit(fixChild.pid);

            // Re-validate after fix attempt
            const retryValidation = runValidation(task.worktreePath, tooling.quickChecks, changedFiles);
            if (!retryValidation.passed) {
              const retryOutput = formatValidationOutput(retryValidation);
              fs.appendFileSync(task.logFile, `\n\n--- RETRY VALIDATION FAILED ---\n${retryOutput}\n`);
              if (idx >= 0) {
                tasks[idx].status = "failed";
                tasks[idx].error = `Validation failed after retry: ${retryValidation.steps.filter((s) => !s.passed).map((s) => s.name).join(", ")}`;
              }
              await updateTaskViaAPI(task.taskId, "needs-human-help", {
                failure_reason: retryOutput.substring(0, 2000),
              });
              writeTasks(tasks);
              return;
            }
            console.log(`[lore] local-runner: fix retry succeeded for ${task.taskId}`);
          }
        }
      }

      // Stage, commit, push, create PR
      execSync("git add -A", {
        cwd: task.worktreePath,
        stdio: "pipe",
        timeout: 30000,
      });

      const branchTail = task.branch.split("/").pop() || task.taskId;
      execSync(
        `git commit -m "lore: local \u2014 ${branchTail}"`,
        { cwd: task.worktreePath, stdio: "pipe", timeout: 30000 },
      );

      execSync(`git push origin ${task.branch}`, {
        cwd: task.worktreePath,
        stdio: "pipe",
        timeout: 60000,
      });

      // Create PR via gh CLI (developer's auth)
      const prTitle = `lore: local \u2014 ${branchTail}`;
      const prBody = [
        "Local task executed by Lore on developer machine.",
        "",
        `Task ID: ${task.taskId}`,
      ].join("\n");
      const prUrl = execSync(
        `gh pr create --title "${prTitle}" --body "${prBody}" --head ${task.branch}`,
        { cwd: task.worktreePath, encoding: "utf-8", timeout: 30000 },
      ).trim();

      if (idx >= 0) {
        tasks[idx].status = "completed";
        tasks[idx].prUrl = prUrl;
      }

      await updateTaskViaAPI(task.taskId, "pr-created", { pr_url: prUrl });
    } else {
      // No changes — mark completed without PR
      if (idx >= 0) tasks[idx].status = "completed";
      await updateTaskViaAPI(task.taskId, "completed", { no_changes: true });
    }

    // Clean up worktree (best effort)
    try {
      // Find the main repo root from the worktree's .git file
      const dotGit = fs.readFileSync(
        path.join(task.worktreePath, ".git"),
        "utf-8",
      );
      const gitDirMatch = dotGit.match(/gitdir:\s*(.+)/);
      if (gitDirMatch) {
        // The gitdir points to .git/worktrees/<name> — go up 3 levels
        const mainGitDir = path.resolve(
          gitDirMatch[1].trim(),
          "..",
          "..",
          "..",
        );
        execSync(`git worktree remove "${task.worktreePath}" --force`, {
          cwd: mainGitDir,
          stdio: "pipe",
          timeout: 10000,
        });
      }
    } catch {
      // Best effort cleanup
      console.error(`[lore] local-runner: could not clean up worktree for ${task.taskId}`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (idx >= 0) {
      tasks[idx].status = "failed";
      tasks[idx].error = errMsg;
    }
    await updateTaskViaAPI(task.taskId, "failed", {
      failure_reason: errMsg,
    });
    // Don't clean up worktree on failure — keep for debugging
    console.error(`[lore] local-runner: task ${task.taskId} failed: ${errMsg}`);
  }

  // Upload redacted logs to GCS via API (best effort)
  try {
    const rawLogs = fs.readFileSync(task.logFile, "utf-8");
    const redacted = redactLogs(rawLogs);
    const apiUrl = getApiUrl();
    const tkn = getToken();
    if (apiUrl && tkn) {
      await fetch(`${apiUrl}/api/task-logs`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${tkn}`, "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.taskId, repo: task.repo, logs: redacted }),
      });
    }
  } catch { /* best effort — local logs still at task.logFile */ }

  writeTasks(tasks);
}

// Use shared redaction (alias for backward compatibility)
const redactLogs = redactSecrets;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawns a local task in a git worktree with a background Claude Code process.
 * Returns immediately — the task runs asynchronously.
 *
 * Pre-fetches assembled context from the Lore API before spawning the agent,
 * so the LLM starts with rich context on turn 1 (Minions-inspired hydration).
 */
export async function spawnLocalTask(opts: {
  taskId: string;
  prompt: string;
  repo: string;
  taskType: string;
  model?: string;
  repoRoot?: string;
}): Promise<LocalTask> {
  ensureDirs();

  const { taskId, prompt, repo, taskType, model } = opts;
  const repoRoot = opts.repoRoot || getRepoRoot();
  if (!repoRoot) {
    throw new Error("Not in a git repository — cannot create worktree");
  }

  const config = readConfig();
  const slug = slugify(prompt.substring(0, 60));
  const shortId = taskId.substring(0, 8);
  const branch = `lore/${taskType}/${slug}-${shortId}`;
  const worktreePath = path.join(WORKTREES_DIR, taskId);
  const logFile = path.join(LOGS_DIR, `${taskId}.log`);

  // Bail if worktree already exists (idempotency)
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree already exists for task ${taskId}`);
  }

  // Create the worktree and branch
  execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
    cwd: repoRoot,
    stdio: "pipe",
    timeout: 30000,
  });

  // ── Pre-run context hydration (Minions-inspired) ──
  // Fetch assembled context BEFORE spawning Claude Code so the agent
  // starts with conventions, ADRs, memories, and graph on turn 1.
  let preContext = "";
  const apiUrl = getApiUrl();
  const token = getToken();
  if (apiUrl && token) {
    try {
      const template = taskType === "review" ? "review" : "implementation";
      const contextUrl = `${apiUrl}/api/context?repo=${encodeURIComponent(repo)}&template=${template}&query=${encodeURIComponent(prompt.substring(0, 200))}`;
      const resp = await fetch(contextUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { text?: string };
        if (data.text) preContext = data.text;
      }
    } catch {
      // Proceed without pre-hydration — agent will call assemble_context itself
    }
  }

  // Build the full prompt with Lore workflow preamble
  const preambleParts: string[] = [];
  if (preContext) {
    preambleParts.push("## Pre-loaded Context\n\n" + preContext + "\n\n---\n");
    preambleParts.push("Context was pre-loaded above. You may call assemble_context for fresh data during long tasks.");
  } else {
    preambleParts.push("IMPORTANT: You have the Lore MCP server. Follow this workflow:");
    preambleParts.push("1. FIRST: Call assemble_context with a query describing this task. This loads conventions, ADRs, memories, facts, and graph.");
  }
  preambleParts.push(
    "2. BEFORE CODING: Call search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.",
    "3. DURING WORK: Use search_context for patterns. Use query_graph for entity relationships.",
    "4. WHEN DONE: Call write_episode with a summary of what you did and any non-obvious decisions.",
    "",
    "Now execute the following task:",
    "",
    prompt,
  );
  const fullPrompt = preambleParts.join("\n");

  // Open log file for stdout/stderr capture
  const logFd = fs.openSync(logFile, "w");

  // Spawn headless Claude Code in the worktree
  const selectedModel = model || config.model || "claude-sonnet-4-6";
  const child = spawn(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      selectedModel,
      "--",
      fullPrompt,
    ],
    {
      cwd: worktreePath,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, HOME: os.homedir() },
    },
  );
  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    // Cleanup on spawn failure
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch { /* best effort */ }
    throw new Error("Failed to spawn Claude Code process");
  }

  // Build task metadata
  const taskMeta: LocalTask = {
    taskId,
    pid: child.pid,
    branch,
    repo,
    worktreePath,
    logFile,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  // Write metadata into the worktree for discoverability
  fs.writeFileSync(
    path.join(worktreePath, ".lore-task.json"),
    JSON.stringify(taskMeta, null, 2),
  );

  // Add to the task registry
  const tasks = readTasks();
  tasks.push(taskMeta);
  writeTasks(tasks);

  // Start background monitoring (fire and forget)
  monitorTask(taskMeta).catch((err) => {
    console.error(`[lore] local-runner: monitor error for ${taskId}: ${err}`);
  });

  return taskMeta;
}

/**
 * Returns all local tasks, updating status of running tasks by checking
 * whether their PID is still alive.
 */
export function listLocalTasks(): LocalTask[] {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (task.status === "running" && !isProcessAlive(task.pid)) {
      task.status = "failed";
      task.error = "Process exited unexpectedly";
      changed = true;
    }
  }

  if (changed) writeTasks(tasks);
  return tasks;
}

/**
 * Cancels a running local task by killing its process and cleaning up
 * the worktree.
 */
export function cancelLocalTask(
  taskId: string,
): { cancelled: boolean; error?: string } {
  const tasks = readTasks();
  const task = tasks.find((t) => t.taskId === taskId);

  if (!task) return { cancelled: false, error: "Task not found" };
  if (task.status !== "running") {
    return { cancelled: false, error: `Task is ${task.status}` };
  }

  // Kill the process
  try {
    process.kill(task.pid, "SIGTERM");
  } catch {
    // Already dead — that's fine
  }

  task.status = "failed";
  task.error = "Cancelled by user";
  writeTasks(tasks);

  // Clean up worktree (best effort)
  try {
    execSync(`git worktree remove "${task.worktreePath}" --force`, {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    console.error(`[lore] local-runner: could not remove worktree for ${taskId}`);
  }

  // Update pipeline status (fire and forget)
  updateTaskViaAPI(taskId, "cancelled", {}).catch(() => {});

  return { cancelled: true };
}

// ---------------------------------------------------------------------------
// Stale Task Cleanup — Phase 3.1
// Detects running tasks whose PID has died. If the task is older than 30
// minutes it's considered stale (e.g. machine slept) and re-queued for GKE.
// Otherwise it's marked as failed (process crashed).
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scans the local task registry for tasks with status "running" whose
 * process is no longer alive.
 *
 * - If the task ran for more than 30 minutes: re-queue to GKE as "pending"
 *   so the cluster agent picks it up, then mark local status "failed".
 * - If less than 30 minutes: mark as "failed" (process crashed).
 *
 * In both cases the orphaned git worktree is cleaned up (best effort).
 */
export async function cleanupStaleTasks(): Promise<void> {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (task.status !== "running") continue;

    if (isProcessAlive(task.pid)) continue;

    const ageMs = Date.now() - new Date(task.startedAt).getTime();

    task.status = "failed";
    task.error = "Process exited unexpectedly";
    changed = true;

    // Clean up orphaned worktree (best effort)
    try {
      if (fs.existsSync(task.worktreePath)) {
        const gitFile = path.join(task.worktreePath, ".git");
        if (fs.existsSync(gitFile)) {
          const gitContent = fs.readFileSync(gitFile, "utf-8");
          const mainRepo = gitContent.match(
            /gitdir:\s*(.+)\/\.git\/worktrees/,
          )?.[1];
          if (mainRepo) {
            execSync(
              `git worktree remove "${task.worktreePath}" --force`,
              { cwd: mainRepo, stdio: "pipe", timeout: 10000 },
            );
          }
        }
      }
    } catch {
      /* best effort */
    }

    // Re-queue for GKE if stale (> 30 min — likely machine slept)
    if (ageMs > STALE_THRESHOLD_MS) {
      const apiUrl = getApiUrl();
      const token = getToken();
      if (apiUrl && token) {
        try {
          await fetch(`${apiUrl}/api/task`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              task_id: task.taskId,
              action: "requeue",
            }),
          });
          task.error = "Stale — re-queued for GKE";
          console.log(
            `[lore] Stale local task ${task.taskId} re-queued for GKE`,
          );
        } catch {
          /* best effort */
        }
      }
    }
  }

  if (changed) writeTasks(tasks);
}

// ---------------------------------------------------------------------------
// Task Notifier — polls for pending tasks and writes to ~/.lore/pending-tasks.json
// Phase 2.2: surfaces notifications, does NOT claim anything.
// ---------------------------------------------------------------------------

let notifierInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Fetches pending pipeline tasks matching the given repos and task types.
 * Prefers a direct DB query when a pool is available; falls back to the
 * Lore API otherwise.
 */
export async function fetchPendingTasks(
  repos: string[],
  taskTypes: string[],
  dbPool?: any,
): Promise<PendingTask[]> {
  if (repos.length === 0 || taskTypes.length === 0) return [];

  // ── Direct DB path (MCP server process has a pool) ──
  if (dbPool) {
    try {
      const { rows } = await dbPool.query(
        `SELECT id, description, task_type, target_repo, created_at, issue_number
         FROM pipeline.tasks
         WHERE status = 'pending'
           AND target_repo = ANY($1)
           AND task_type = ANY($2)
         ORDER BY created_at ASC
         LIMIT 10`,
        [repos, taskTypes],
      );
      return rows.map((r: any) => ({
        id: r.id,
        description: (r.description || "").substring(0, 200),
        task_type: r.task_type,
        target_repo: r.target_repo,
        created_at: r.created_at,
        issue_number: r.issue_number ?? undefined,
      }));
    } catch {
      // Fall through to API path
    }
  }

  // ── API fallback ──
  const apiUrl = getApiUrl();
  const token = getToken();
  if (!apiUrl || !token) return [];

  try {
    const resp = await fetch(`${apiUrl}/api/task`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "list", status: "pending" }),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    const tasks: PendingTask[] = (data.tasks || [])
      .filter(
        (t: any) =>
          repos.includes(t.target_repo) && taskTypes.includes(t.task_type),
      )
      .map((t: any) => ({
        id: t.id,
        description: (t.description || "").substring(0, 200),
        task_type: t.task_type,
        target_repo: t.target_repo,
        created_at: t.created_at,
        issue_number: t.issue_number ?? undefined,
      }));
    return tasks;
  } catch {
    return [];
  }
}

/**
 * Starts the background task notifier. Polls every 30 s for pending
 * pipeline tasks matching the given repos/taskTypes and writes them to
 * `~/.lore/pending-tasks.json`. Does NOT claim or modify any task —
 * this is a read-only notification mechanism.
 *
 * The statusline reads pending-tasks.json to show "N new task(s)".
 */
export function startNotifier(
  repos: string[],
  taskTypes: string[],
  dbPool?: any,
): void {
  if (notifierInterval) return; // Already running

  let pollCount = 0;

  const poll = async () => {
    try {
      const tasks = await fetchPendingTasks(repos, taskTypes, dbPool);
      fs.writeFileSync(PENDING_FILE, JSON.stringify(tasks, null, 2));
    } catch {
      // Best effort — never crash the MCP server
    }

    // Run stale task cleanup every 5th cycle (~2.5 min at 30 s interval)
    pollCount++;
    if (pollCount % 5 === 0) {
      await cleanupStaleTasks().catch(() => {});
    }
  };

  // Run immediately, then on interval
  poll();
  notifierInterval = setInterval(poll, 30_000);
}

/** Stops the background notifier and removes the pending-tasks file. */
export function stopNotifier(): void {
  if (notifierInterval) {
    clearInterval(notifierInterval);
    notifierInterval = null;
  }
  try {
    fs.unlinkSync(PENDING_FILE);
  } catch {
    // File may not exist
  }
}

/** Returns true if the notifier polling loop is active. */
export function isNotifierRunning(): boolean {
  return notifierInterval !== null;
}

/**
 * Returns the current list of pending tasks from the cached JSON file.
 * Returns an empty array if the file doesn't exist or is unreadable.
 */
export function listPendingTasks(): PendingTask[] {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Removes a task from the local pending-tasks.json so the notification
 * disappears. The task remains pending on the server — GKE will pick it
 * up after its 30 s grace period unless claimed first.
 */
export function skipTask(taskId: string): void {
  const tasks = listPendingTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);
  fs.writeFileSync(PENDING_FILE, JSON.stringify(filtered, null, 2));
}
