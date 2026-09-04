// Local task runner storage: on-disk config/task state, repo detection, and the best-effort Lore API credentials/updates shared by every runner module.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

const LORE_DIR = path.join(os.homedir(), ".lore");

export const WORKTREES_DIR = path.join(LORE_DIR, "worktrees");
export const LOGS_DIR = path.join(LORE_DIR, "task-logs");
const TASKS_FILE = path.join(LORE_DIR, "local-tasks.json");

export const PENDING_FILE = path.join(LORE_DIR, "pending-tasks.json");
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

// Lore's own /api/task pending-list wire shape; also the on-disk pending-tasks.json read by scripts/lore-statusline.sh.
// eslint-disable-next-line lore/no-row-types-outside-models
export interface PendingTask {
  id: string;
  description: string;
  task_type: string;
  target_repo: string;
  created_at: string;
  issue_number?: number;
}

export function ensureDirs(): void {
  for (const dir of [WORKTREES_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readTasks(): LocalTask[] {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function writeTasks(tasks: LocalTask[]): void {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

export function slugify(text: string): string {
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
export function getApiUrl(): string {
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

export function getToken(): string {
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

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function warnBestEffort(op: string, err: unknown): void {
  console.error(`[lore] local-runner: ${op} failed: ${errorMessage(err)}`);
}

export async function updateTaskViaAPI(
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
export async function waitForExit(pid: number): Promise<void> {
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
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}
