import type { PgPool } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// Local task runner: spawns headless Claude Code in isolated git worktrees using the developer's subscription (zero API cost).
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectTooling,
  runValidation,
  formatValidationOutput,
} from "@re-cinq/lore-shared";
import { redactSecrets } from "@re-cinq/lore-shared";

const LORE_DIR = path.join(os.homedir(), ".lore");
const WORKTREES_DIR = path.join(LORE_DIR, "worktrees");
const LOGS_DIR = path.join(LORE_DIR, "task-logs");
const TASKS_FILE = path.join(LORE_DIR, "local-tasks.json");
const PENDING_FILE = path.join(LORE_DIR, "pending-tasks.json");
const CONFIG_FILE = path.join(LORE_DIR, "local-runner.json");

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
    return {
      enabled: false,
      max_concurrent: 2,
      repos: [],
      task_types: ["implementation", "general", "runbook", "gap-fill"],
      model: "claude-sonnet-4-6",
    };
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

// Guards against opening a PR on the wrong repo when cwd doesn't match task.target_repo — throw rather than silently push to the wrong remote.
export function validateRepoMatch(
  taskRepo: string,
  cwdRepo: string | null,
): void {
  enforceTrue(
    !(cwdRepo && cwdRepo !== taskRepo),
    Error,
    `target_repo mismatch: task expects '${taskRepo}' but current directory is a checkout of '${cwdRepo}'. ` +
      `cd to a checkout of ${taskRepo} before claiming this task.`,
  );
}

// API helpers: best-effort updates to the GKE pipeline.
function getApiUrl(): string {
  if (process.env.LORE_API_URL) {
    return process.env.LORE_API_URL;
  }

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
  if (process.env.LORE_INGEST_TOKEN) {
    return process.env.LORE_INGEST_TOKEN;
  }

  try {
    return execSync("git config --global lore.ingest-token", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function warnBestEffort(op: string, err: unknown): void {
  console.error(`[lore] local-runner: ${op} failed: ${errorMessage(err)}`);
}

async function updateTaskViaAPI(
  taskId: string,
  status: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return;
  }

  try {
    await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_id: taskId, status, ...metadata }),
    });
  } catch (err) {
    warnBestEffort(`status update (${status}) for task ${taskId}`, err);
  }
}

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

// Spawns a Claude Code fix retry for a failed validation and re-validates; returns null when the fix child never got a pid.
/** The one retry a failed validation gets: a prompt that says fix ONLY these errors, run headless in the same worktree. */
async function attemptValidationFix(
  task: LocalTask,
  quickChecks: ReturnType<typeof detectTooling>["quickChecks"],
  changedFiles: string[],
  fixOutput: string,
): Promise<Awaited<ReturnType<typeof runValidation>> | null> {
  console.log(
    `[lore] local-runner: validation failed, attempting fix retry for ${task.taskId}`,
  );
  fs.appendFileSync(
    task.logFile,
    `\n\n--- VALIDATION FAILED ---\n${fixOutput}\n`,
  );
  const pid = spawnFixRun(task, fixOutput);

  if (pid === undefined) {
    return null;
  }
  await waitForExit(pid);

  return runValidation(task.worktreePath, quickChecks, changedFiles);
}

/** Detached so the fix survives this process; its output appends to the task's own log rather than opening a second one. */
function spawnFixRun(task: LocalTask, fixOutput: string): number | undefined {
  const fixPrompt = [
    "Validation checks failed after your changes. Fix ONLY these errors.",
    "Do not re-implement the original task. Only fix the validation errors.",
    "",
    fixOutput,
  ].join("\n");
  const logFd = fs.openSync(task.logFile, "a");
  const errFd = fs.openSync(errFileFor(task.logFile), "a");
  const child = spawn("claude", claudeArgs(readConfig().model, fixPrompt), {
    cwd: task.worktreePath,
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env, HOME: os.homedir() },
  });

  child.unref();
  fs.closeSync(logFd);
  fs.closeSync(errFd);

  return child.pid;
}

/** Headless streaming JSON, permissions skipped — the worktree is disposable and the run is unattended. */
function claudeArgs(model: string | undefined, prompt: string): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    model || "claude-sonnet-4-6",
    "--",
    prompt,
  ];
}

// Deterministic validation (Minions-inspired): lint/typecheck before commit with one fix retry; "failed" means the task was marked needs-human-help and its artifacts persisted.
async function validateBeforeCommit(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  changedFiles: string[],
): Promise<"passed" | "failed"> {
  const tooling = detectTooling(task.worktreePath);

  if (tooling.quickChecks.length === 0) {
    return "passed";
  }
  console.log(
    `[lore] local-runner: running ${tooling.language} validation (${tooling.quickChecks.map((s) => s.name).join(", ")})`,
  );
  const validation = await runValidation(
    task.worktreePath,
    tooling.quickChecks,
    changedFiles,
  );

  if (validation.passed) {
    return "passed";
  }
  const retry = await attemptValidationFix(
    task,
    tooling.quickChecks,
    changedFiles,
    formatValidationOutput(validation),
  );

  // A fix run that never started leaves the original changes to commit — the same as having had no validation at all.
  if (!retry || retry.passed) {
    return "passed";
  }
  await handOffToHuman(task, tasks, idx, retry);

  return "failed";
}

/** Twice-failed validation is not this runner's to resolve: mark the task, keep the transcript, and leave the worktree in place for whoever picks it up. */
async function handOffToHuman(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  retry: Awaited<ReturnType<typeof runValidation>>,
): Promise<void> {
  const output = formatValidationOutput(retry);
  const failedNames = retry.steps
    .filter((s) => !s.passed)
    .map((s) => s.name)
    .join(", ");

  fs.appendFileSync(
    task.logFile,
    `\n\n--- RETRY VALIDATION FAILED ---\n${output}\n`,
  );

  if (idx >= 0) {
    tasks[idx].status = "failed";
    tasks[idx].error = `Validation failed after retry: ${failedNames}`;
  }
  await updateTaskViaAPI(task.taskId, "needs-human-help", {
    failure_reason: output.substring(0, 2000),
  });
  // Write status before the artifact round-trips — holding it across slow network calls widens the lost-update window against a concurrently finishing task.
  writeTasks(tasks);
  // needs-human-help runs still upload the transcript (a human needs it); worktree cleanup stays skipped on purpose for debugging.
  await persistRunArtifacts(task);
}

/** Stages the worktree, then commits, pushes, and opens a PR — or marks the task completed when nothing staged. */
async function commitAndOpenPr(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<void> {
  execSync("git add -A", {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 30000,
  });

  // Verify the index actually has changes before commit/push/PR — `git status --porcelain` can include files stripped on add (#250).
  const stagedFiles = execSync("git diff --cached --name-only", {
    cwd: task.worktreePath,
    encoding: "utf-8",
    timeout: 10000,
  }).trim();

  if (!stagedFiles) {
    await completeWithoutChanges(task, tasks, idx);

    return;
  }
  const prUrl = pushAndOpenPr(task);

  if (idx >= 0) {
    tasks[idx].status = "completed";
    tasks[idx].prUrl = prUrl;
  }
  await updateTaskViaAPI(task.taskId, "pr-created", { pr_url: prUrl });
}

/** A run that changed nothing is finished, not failed — there is simply no PR to point at. */
async function completeWithoutChanges(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
): Promise<void> {
  if (idx >= 0) {
    tasks[idx].status = "completed";
  }
  console.log(
    `[lore] local-runner: ${task.taskId} produced no staged changes — skipping PR`,
  );
  await updateTaskViaAPI(task.taskId, "completed", { no_changes: true });
}

/** Commit, push, and open the PR through `gh` — the developer's own auth, never the platform's. */
function pushAndOpenPr(task: LocalTask): string {
  const branchTail = task.branch.split("/").pop() || task.taskId;
  const body = [
    "Local task executed by Lore on developer machine.",
    "",
    `Task ID: ${task.taskId}`,
  ].join("\n");

  execSync(`git commit -m "lore: local — ${branchTail}"`, {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 30000,
  });
  execSync(`git push origin ${task.branch}`, {
    cwd: task.worktreePath,
    stdio: "pipe",
    timeout: 60000,
  });

  return execSync(
    `gh pr create --title "lore: local — ${branchTail}" --body "${body}" --head ${task.branch}`,
    { cwd: task.worktreePath, encoding: "utf-8", timeout: 30000 },
  ).trim();
}

/** Validates then commits/PRs the worktree's uncommitted changes. */
async function processWorktreeChanges(
  task: LocalTask,
  tasks: LocalTask[],
  idx: number,
  status: string,
): Promise<"validation-failed" | "done"> {
  const changedFiles = status
    .split("\n")
    .map((line) => line.substring(3).trim())
    .filter(Boolean);
  const validationVerdict = await validateBeforeCommit(
    task,
    tasks,
    idx,
    changedFiles,
  );

  if (validationVerdict === "failed") {
    return "validation-failed";
  }
  await commitAndOpenPr(task, tasks, idx);

  return "done";
}

async function monitorTask(task: LocalTask): Promise<void> {
  await waitForExit(task.pid);

  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.taskId === task.taskId);

  try {
    // `git status --porcelain` in the worktree is the whole verdict on whether the run did anything.
    const status = execSync("git status --porcelain", {
      cwd: task.worktreePath,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    const verdict = status
      ? await processWorktreeChanges(task, tasks, idx, status)
      : "no-changes";

    // A validation hand-off already wrote status and artifacts, and deliberately keeps its worktree.
    if (verdict === "validation-failed") {
      return;
    }

    if (verdict === "no-changes") {
      await completeWithoutChanges(task, tasks, idx);
    }
    removeWorktree(task);
  } catch (err: unknown) {
    const errMsg = errorMessage(err);

    if (idx >= 0) {
      tasks[idx].status = "failed";
      tasks[idx].error = errMsg;
    }
    await updateTaskViaAPI(task.taskId, "failed", { failure_reason: errMsg });
    // Don't clean up worktree on failure — keep for debugging
    console.error(`[lore] local-runner: task ${task.taskId} failed: ${errMsg}`);
  }
  // Same ordering rule as the early-return path: persist the status snapshot before the slow artifact round-trips.
  writeTasks(tasks);
  await persistRunArtifacts(task);
}

/** Best effort: the worktree's `.git` file points at `.git/worktrees/<name>` in the main checkout, which is the only place `git worktree remove` can run from. A failure here costs disk, not correctness. */
function removeWorktree(task: LocalTask): void {
  try {
    const dotGit = fs.readFileSync(
      path.join(task.worktreePath, ".git"),
      "utf-8",
    );
    const gitDir = /gitdir:\s*(.+)/.exec(dotGit);

    if (gitDir) {
      execSync(`git worktree remove "${task.worktreePath}" --force`, {
        cwd: path.resolve(gitDir[1].trim(), "..", "..", ".."),
        stdio: "pipe",
        timeout: 10000,
      });
    }
  } catch {
    console.error(
      `[lore] local-runner: could not clean up worktree for ${task.taskId}`,
    );
  }
}

// Use shared redaction (alias for backward compatibility)
const redactLogs = redactSecrets;

// Turn ingest: relays the run's stream-json transcript to the Floor's turn store via lore-api POST /api/task-turns/{taskId}, redacted per line before anything leaves the machine (#1295).

// Sibling file capturing stderr, kept out of the NDJSON transcript so a stderr write can never land mid-JSON-line.
function errFileFor(logFile: string): string {
  return `${logFile}.err`;
}

/** A blank or non-JSON raw line carries nothing worth redacting or relaying. */
function isUsableRawLine(line: string): boolean {
  return line.length > 0 && parsesAsJson(line);
}

/** True when redaction left the line intact, or still valid JSON despite the edits. */
function redactedLineIsUsable(redacted: string, original: string): boolean {
  return redacted === original || parsesAsJson(redacted);
}

// Redacts per line (matching the Floor's rule — a whole-text pass could span JSON boundaries and erase lines in between); a line whose JSON breaks under redaction is counted in `dropped`.
export function buildTurnLines(
  rawLog: string,
  redact: (text: string) => string = redactLogs,
): { lines: string[]; dropped: number } {
  const lines: string[] = [];
  let dropped = 0;

  for (const raw of rawLog.split("\n")) {
    const line = raw.trim();

    if (!isUsableRawLine(line)) {
      continue;
    }

    const redacted = redact(line);

    if (redactedLineIsUsable(redacted, line)) {
      lines.push(redacted);
      continue;
    }
    dropped++;
  }

  return { lines, dropped };
}

function parsesAsJson(line: string): boolean {
  try {
    JSON.parse(line);

    return true;
  } catch {
    return false;
  }
}

// Greedy batches under both relay caps (bytes and line count) — lore-api's body limit is 1MB, so the caller passes ~700KB headroom.
export function batchTurnLines(
  lines: string[],
  maxBytes: number,
  maxLines: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;

    if (
      batch.length > 0 &&
      (batch.length >= maxLines || batchBytes + lineBytes > maxBytes)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(line);
    batchBytes += lineBytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

const TURN_BATCH_MAX_BYTES = 700 * 1024;
const TURN_BATCH_MAX_LINES = 2000;

// A line whose own bytes exceed the batch cap can never relay (lore-api would 413 the whole request), so it's dropped loudly here instead of costing the batches behind it.
export function dropOversizedTurnLines(
  lines: string[],
  maxBytes: number,
): { kept: string[]; oversized: number } {
  const kept = lines.filter(
    (line) => Buffer.byteLength(line, "utf8") + 1 <= maxBytes,
  );

  return { kept, oversized: lines.length - kept.length };
}

// Exported for tests (the x-turn-offset accounting); production callers stay inside this module via persistRunArtifacts.
export async function ingestTurns(
  task: LocalTask,
  rawLogs: string,
): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return;
  }
  const kept = turnLinesToRelay(task, rawLogs);
  // A failed batch is counted and skipped, never aborting — the terminal result line rides last, so stopping early would cost the whole transcript tail.
  let failed = 0;
  // Each batch declares its cumulative start offset so the relay can key lines by position and dedup a re-POST (#1389); advanced on failure too.
  let offset = 0;

  for (const batch of batchTurnLines(
    kept,
    TURN_BATCH_MAX_BYTES,
    TURN_BATCH_MAX_LINES,
  )) {
    const posted = await postTurnBatch({ apiUrl, token, task }, batch, offset);

    offset += batch.length;
    failed += posted ? 0 : 1;
  }

  if (failed > 0) {
    console.warn(
      `[lore] local-runner: ${failed} turn batch(es) failed for ${task.taskId}`,
    );
  }
}

/** The lines worth relaying, with both ways a line is lost reported: redaction left it unparseable, or the line alone exceeds the relay cap. */
function turnLinesToRelay(task: LocalTask, rawLogs: string): string[] {
  const { lines, dropped } = buildTurnLines(rawLogs);

  if (dropped > 0) {
    console.warn(
      `[lore] local-runner: ${dropped} turn line(s) dropped for ${task.taskId}: redaction left the line unparseable`,
    );
  }
  const { kept, oversized } = dropOversizedTurnLines(
    lines,
    TURN_BATCH_MAX_BYTES,
  );

  if (oversized > 0) {
    console.warn(
      `[lore] local-runner: ${oversized} turn line(s) dropped for ${task.taskId}: line exceeds the ${TURN_BATCH_MAX_BYTES}-byte relay cap`,
    );
  }

  return kept;
}

async function postTurnBatch(
  relay: { apiUrl: string; token: string; task: LocalTask },
  batch: string[],
  offset: number,
): Promise<boolean> {
  const { apiUrl, token, task } = relay;

  try {
    const resp = await fetch(`${apiUrl}/api/task-turns/${task.taskId}`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-ndjson",
        "x-turn-offset": String(offset),
      },
      body: batch.join("\n"),
    });

    enforceTrue(
      resp.ok,
      Error,
      `turn ingest returned ${resp.status} for task ${task.taskId}`,
    );

    return true;
  } catch (err) {
    warnBestEffort(
      `turn batch (${batch.length} lines) for task ${task.taskId}`,
      err,
    );

    return false;
  }
}

// Best-effort persistence of the run's artifacts (redacted log to GCS + redacted transcript to the Floor's turn store); called on EVERY monitorTask exit path, including needs-human-help, since failed runs matter most.
async function persistRunArtifacts(task: LocalTask): Promise<void> {
  let rawLogs = "";

  try {
    rawLogs = fs.readFileSync(task.logFile, "utf-8");
    await uploadLogs(task, rawLogs);
  } catch (err) {
    warnBestEffort(
      `log upload for task ${task.taskId} (logs kept locally)`,
      err,
    );
  }

  try {
    await ingestTurns(task, rawLogs);
  } catch (err) {
    warnBestEffort(
      `turn ingest for task ${task.taskId} (transcript kept locally)`,
      err,
    );
  }
}

/** stderr is appended as a trailing block, not interleaved with stdout — chronology across the two streams is lost in the GCS copy. */
async function uploadLogs(task: LocalTask, rawLogs: string): Promise<void> {
  const errFile = errFileFor(task.logFile);
  const stderr = fs.existsSync(errFile)
    ? fs.readFileSync(errFile, "utf-8").trim()
    : "";
  const combined = stderr ? `${rawLogs}\n--- STDERR ---\n${stderr}\n` : rawLogs;
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return;
  }
  await fetch(`${apiUrl}/api/task-logs`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task_id: task.taskId,
      repo: task.repo,
      logs: redactLogs(combined),
    }),
  });
}

// The Lore workflow preamble every locally-run task opens with — nothing is pre-fetched, so the agent assembles its own context through the MCP server as step 1.
export function withLoreWorkflowPreamble(prompt: string): string {
  return [
    "IMPORTANT: You have the Lore MCP server. Follow this workflow:",
    "1. FIRST: Call lore_assemble_context with a query describing this task. This loads conventions, ADRs, memories, facts, and graph.",
    "2. BEFORE CODING: Call lore_search_memory to check if this problem was already solved or has known gotchas. Try multiple queries.",
    "3. DURING WORK: Use lore_search_context for patterns. Use lore_query_graph for entity relationships.",
    "4. WHEN DONE: Call lore_write_episode with a summary of what you did and any non-obvious decisions.",
    "",
    "Now execute the following task:",
    "",
    prompt,
  ].join("\n");
}

// Spawns a local task in a git worktree with a background Claude Code process and returns immediately; the agent starts cold and assembles its own context via the MCP server.
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

  enforceTrue(
    repoRoot,
    Error,
    "Not in a git repository — cannot create worktree",
  );

  // Refuse to run if the developer's cwd is a checkout of a different repo than the task's target_repo.
  validateRepoMatch(repo, detectRepo());

  const branch = `lore/${taskType}/${slugify(prompt.substring(0, 60))}-${taskId.substring(0, 8)}`;
  const worktreePath = path.join(WORKTREES_DIR, taskId);
  const logFile = path.join(LOGS_DIR, `${taskId}.log`);

  // Bail if worktree already exists (idempotency)
  enforceTrue(
    !fs.existsSync(worktreePath),
    Error,
    `Worktree already exists for task ${taskId}`,
  );

  execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
    cwd: repoRoot,
    stdio: "pipe",
    timeout: 30000,
  });

  const pid = spawnRun(
    worktreePath,
    logFile,
    model || readConfig().model,
    withLoreWorkflowPreamble(prompt),
  );

  if (pid === undefined) {
    removeWorktreeAt(repoRoot, worktreePath);

    throw new Error("Failed to spawn Claude Code process");
  }
  const taskMeta: LocalTask = {
    taskId,
    pid,
    branch,
    repo,
    worktreePath,
    logFile,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  // Task metadata goes into ~/.lore/local-tasks.json only, never inside the worktree — writing it there previously caused noise PRs (#250).
  const tasks = readTasks();

  tasks.push(taskMeta);
  writeTasks(tasks);
  monitorTask(taskMeta).catch((err) => {
    console.error(`[lore] local-runner: monitor error for ${taskId}: ${err}`);
  });

  return taskMeta;
}

/** Headless Claude Code, detached in the worktree. stdout gets the stream-json transcript (the turn-ingest source, #1295); stderr goes to a sibling file so it can never corrupt an NDJSON line mid-write. */
function spawnRun(
  worktreePath: string,
  logFile: string,
  model: string | undefined,
  prompt: string,
): number | undefined {
  const logFd = fs.openSync(logFile, "w");
  const errFd = fs.openSync(errFileFor(logFile), "w");
  const child = spawn("claude", claudeArgs(model, prompt), {
    cwd: worktreePath,
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env, HOME: os.homedir() },
  });

  child.unref();
  fs.closeSync(logFd);
  fs.closeSync(errFd);

  return child.pid;
}

function removeWorktreeAt(repoRoot: string, worktreePath: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    /* best effort */
  }
}

/** Returns all local tasks, updating status of running tasks by checking whether their PID is still alive. */
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

  if (changed) {
    writeTasks(tasks);
  }

  return tasks;
}

export function cancelLocalTask(taskId: string): {
  cancelled: boolean;
  error?: string;
} {
  const tasks = readTasks();
  const task = tasks.find((t) => t.taskId === taskId);

  if (!task) {
    return { cancelled: false, error: "Task not found" };
  }

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
    console.error(
      `[lore] local-runner: could not remove worktree for ${taskId}`,
    );
  }

  // Update pipeline status (fire and forget)
  updateTaskViaAPI(taskId, "cancelled", {}).catch((err) =>
    warnBestEffort(`cancel status update for task ${taskId}`, err),
  );

  return { cancelled: true };
}

// Stale Task Cleanup (Phase 3.1): a running task whose PID has died is re-queued to GKE as "pending" if older than 30 min (machine likely slept), else marked failed; the orphaned worktree is always cleaned up best effort.

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Removes an orphaned worktree by resolving its main repo from the .git file. */
function removeOrphanedWorktree(worktreePath: string): void {
  if (!fs.existsSync(worktreePath)) {
    return;
  }
  const gitFile = path.join(worktreePath, ".git");

  if (!fs.existsSync(gitFile)) {
    return;
  }
  const gitContent = fs.readFileSync(gitFile, "utf-8");
  const mainRepo = gitContent.match(/gitdir:\s*(.+)\/\.git\/worktrees/)?.[1];

  if (!mainRepo) {
    return;
  }
  execSync(`git worktree remove "${worktreePath}" --force`, {
    cwd: mainRepo,
    stdio: "pipe",
    timeout: 10000,
  });
}

/** Re-queues a stale local task for GKE (best effort). */
async function requeueStaleTask(task: LocalTask): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!(apiUrl && token)) {
    return;
  }

  try {
    await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
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
    console.log(`[lore] Stale local task ${task.taskId} re-queued for GKE`);
  } catch {
    /* best effort */
  }
}

/** True once a dead task has been unattended long enough that the machine likely slept. */
function isStaleForRequeue(startedAt: string): boolean {
  return Date.now() - new Date(startedAt).getTime() > STALE_THRESHOLD_MS;
}

/** Marks a dead task failed, best-effort-cleans its orphaned worktree, and re-queues it for GKE when stale enough. */
async function recoverStaleTask(task: LocalTask): Promise<void> {
  task.status = "failed";
  task.error = "Process exited unexpectedly";

  try {
    removeOrphanedWorktree(task.worktreePath);
  } catch {
    /* best effort */
  }

  if (isStaleForRequeue(task.startedAt)) {
    await requeueStaleTask(task);
  }
}

export async function cleanupStaleTasks(): Promise<void> {
  const tasks = readTasks();
  let changed = false;

  for (const task of tasks) {
    if (task.status !== "running") {
      continue;
    }

    if (isProcessAlive(task.pid)) {
      continue;
    }

    await recoverStaleTask(task);
    changed = true;
  }

  if (changed) {
    writeTasks(tasks);
  }
}

// Task Notifier (Phase 2.2): polls for pending tasks and writes to ~/.lore/pending-tasks.json; surfaces notifications, does NOT claim anything.

let notifierInterval: ReturnType<typeof setInterval> | null = null;

// Fetches pending pipeline tasks matching the given repos/task types; prefers a direct DB query when a pool is available, else falls back to the Lore API.
export async function fetchPendingTasks(
  repos: string[],
  taskTypes: string[],
  dbPool?: PgPool,
): Promise<PendingTask[]> {
  if (repos.length === 0 || taskTypes.length === 0) {
    return [];
  }
  // The pool is the fast path when this process has one; anything wrong with it falls through to the API rather than failing the poll.
  const direct = dbPool ? await pendingFromDb(dbPool, repos, taskTypes) : null;

  return direct ?? (await pendingFromApi(repos, taskTypes));
}

async function pendingFromDb(
  dbPool: PgPool,
  repos: string[],
  taskTypes: string[],
): Promise<PendingTask[] | null> {
  try {
    const { rows } = await dbPool.query<{
      id: string;
      description: string | null;
      task_type: string;
      target_repo: string;
      created_at: string;
      issue_number: number | null;
    }>(
      `SELECT id, description, task_type, target_repo, created_at, issue_number
         FROM pipeline.tasks
         WHERE status = 'pending'
           AND target_repo = ANY($1)
           AND task_type = ANY($2)
         ORDER BY created_at ASC
         LIMIT 10`,
      [repos, taskTypes],
    );

    return rows.map((r) => pendingTask(r));
  } catch {
    return null;
  }
}

async function pendingFromApi(
  repos: string[],
  taskTypes: string[],
): Promise<PendingTask[]> {
  const apiUrl = getApiUrl();
  const token = getToken();

  if (!apiUrl || !token) {
    return [];
  }

  try {
    const resp = await fetch(`${apiUrl}/api/task`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "list", status: "pending" }),
    });

    if (!resp.ok) {
      return [];
    }
    const body = (await resp.json()) as { tasks?: PendingTaskRow[] };

    // The API answers with every pending task; the repo/type filter the SQL did is applied here instead.
    return (body.tasks || [])
      .filter(
        (t) => repos.includes(t.target_repo) && taskTypes.includes(t.task_type),
      )
      .map((t) => pendingTask(t));
  } catch {
    return [];
  }
}

interface PendingTaskRow {
  id: string;
  description?: string | null;
  task_type: string;
  target_repo: string;
  created_at: string;
  issue_number?: number | null;
}

function pendingTask(row: PendingTaskRow): PendingTask {
  return {
    id: row.id,
    description: (row.description || "").substring(0, 200),
    task_type: row.task_type,
    target_repo: row.target_repo,
    created_at: row.created_at,
    issue_number: row.issue_number ?? undefined,
  };
}

// Starts the background task notifier: polls every 30s, writes matches to ~/.lore/pending-tasks.json (read-only, never claims), which the statusline reads to show "N new task(s)".
export function startNotifier(
  repos: string[],
  taskTypes: string[],
  dbPool?: PgPool,
): void {
  if (notifierInterval) {
    return;
  } // Already running

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
      await cleanupStaleTasks().catch((err) =>
        warnBestEffort("stale-task cleanup sweep", err),
      );
    }
  };

  // Run immediately, then on interval
  void poll();
  notifierInterval = setInterval(() => void poll(), 30_000);
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

export function listPendingTasks(): PendingTask[] {
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// Removes a task from local pending-tasks.json so the notification disappears; it remains pending server-side, and GKE picks it up after its 30s grace period unless claimed first.
export function skipTask(taskId: string): void {
  const tasks = listPendingTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);

  fs.writeFileSync(PENDING_FILE, JSON.stringify(filtered, null, 2));
}
