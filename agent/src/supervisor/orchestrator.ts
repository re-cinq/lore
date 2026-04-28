import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { callLLM } from "../anthropic.js";
import { query } from "../db.js";
import { writeEpisode, writeEpisodeWithCuration } from "../lib/episode-writer.js";
import { evaluateAndMerge } from "../jobs/auto-merge.js";
import { prFooter } from "../lib/pr-body.js";
import { runSupervisor } from "./index.js";
import { loadWorkflowDir, type Workflow } from "../workflow/loader.js";
import { createAgentHandler } from "./agent-handler.js";
import { createProductionHandlers } from "./handlers.js";
import { buildPrompt, getTaskTypeConfig } from "../config.js";
/**
 * Mirror of `mcp-server/src/dark-factory-settings.ResolvedDarkFactorySettings`.
 * Duplicated here so the agent doesn't import across workspaces.
 */
export interface ResolvedDarkFactorySettings {
  enabled: boolean;
  create_issue: "never" | "on_gate" | "always";
  auto_merge: {
    paths: string[];
    min_trust: "docs" | "tests" | "implementation" | "full";
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: "trust_based" | "always" | "never";
  notify: Array<"escalation" | "watched" | "all">;
}

const execFile = promisify(execFileCb);

/**
 * In-agent task processor for dark-mode tasks (T058 follow-up). When a
 * pipeline task lands on a repo with `dark_factory.enabled = true` and
 * a workflow exists for the task type, the worker dispatches here
 * instead of handing off to the LoreTask CRD path. Limited in scope
 * to JSON-output workflows (gap-fill, runbook); Claude-Code-driven
 * task types (implementation, general) continue to run via the Job
 * pod path until the entrypoint.sh refactor lands.
 */
export interface ProcessTaskViaSupervisorOptions {
  task: {
    id: string;
    description: string;
    task_type: string;
    target_repo: string;
  };
  /** Per-repo dark-factory policy already resolved by the caller. */
  settings: ResolvedDarkFactorySettings;
  /** Override for tests — defaults to load from `agent/src/workflows/`. */
  loadWorkflows?: (dir: string) => Promise<Map<string, Workflow>>;
  /** Override for tests — defaults to constructing an Octokit. */
  octokit?: Octokit;
  /** Override for tests — defaults to using the production agent handler. */
  workdir?: string;
}

export interface ProcessTaskViaSupervisorResult {
  outcome:
    | "pr_created"
    | "no_changes"
    | "lease_held"
    | "iteration_max"
    | "error";
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  errorMessage?: string;
}

const WORKFLOWS_DIR = path.resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "workflows",
);

/**
 * Maps task_type → workflow name. The workflow YAML's `name` field is
 * the resolution key. Today's dark-factory MVP only routes gap-fill +
 * runbook through here; other task types continue via the legacy path.
 */
const SUPPORTED_TASK_TYPES = new Set(["gap-fill", "runbook"]);

export function isDarkFactoryEligible(taskType: string): boolean {
  return SUPPORTED_TASK_TYPES.has(taskType);
}

export async function processTaskViaSupervisor(
  opts: ProcessTaskViaSupervisorOptions,
): Promise<ProcessTaskViaSupervisorResult> {
  const { task, settings } = opts;
  const branchSlug = task.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");
  const branchName = `lore/${task.task_type}/${branchSlug}-${task.id.slice(0, 8)}`;

  const workflows = await (opts.loadWorkflows ?? loadWorkflowDir)(WORKFLOWS_DIR);
  const workflow = workflows.get(task.task_type);
  if (!workflow) {
    return {
      outcome: "error",
      errorMessage: `no workflow defined for task type "${task.task_type}"`,
    };
  }

  const octokit = opts.octokit ?? buildOctokit();
  const workdir =
    opts.workdir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), `lore-supervisor-${task.id}-`)));

  let cleanupWorkdir = !opts.workdir; // only delete what we created

  try {
    await cloneAndBranch(workdir, task.target_repo, branchName, octokit);

    const agentHandler = createAgentHandler(
      {
        callLLM,
        resolvePrompt: (promptRef, description) => {
          const config = getTaskTypeConfig(promptRef);
          if (!config) return null;
          return {
            systemPrompt:
              `Output a JSON object with shape ` +
              `\`{ "files": { "<relative-path>": "<file content>" } }\`. ` +
              `Output JSON only — no prose, no code fences.`,
            prompt: buildPrompt(promptRef, description),
          };
        },
      },
      {
        taskId: task.id,
        description: task.description,
        taskType: task.task_type,
      },
    );

    const handlers = createProductionHandlers({
      agent: agentHandler,
      episodeDeps: {
        writeEpisode,
        writeEpisodeWithCuration,
        curate: true,
        evaluateAndMerge,
        resolvePrForTask: async (taskId) =>
          await resolvePrForTaskFromDb(taskId, settings, octokit),
      },
    });

    const result = await runSupervisor({
      taskId: task.id,
      branchName,
      workflowName: workflow.name,
      gitDir: workdir,
      workflow,
      handlers,
    });

    if (result.reason === "lease_held") {
      return { outcome: "lease_held", branchName };
    }
    if (result.reason === "iteration_max_exceeded") {
      return {
        outcome: "iteration_max",
        branchName,
        errorMessage: result.errorMessage,
      };
    }
    if (result.reason === "executor_error") {
      return {
        outcome: "error",
        branchName,
        errorMessage: result.errorMessage,
      };
    }

    // Push the branch and open the PR.
    return await pushAndOpenPr({
      workdir,
      repo: task.target_repo,
      branchName,
      task,
      octokit,
    });
  } catch (err) {
    return {
      outcome: "error",
      branchName,
      errorMessage: (err as Error).message,
    };
  } finally {
    if (cleanupWorkdir) {
      await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildOctokit(): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (appId && privateKey && installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    });
  }
  if (process.env.GITHUB_TOKEN) {
    return new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  throw new Error(
    "GitHub not configured: set GITHUB_APP_* or GITHUB_TOKEN to use the supervisor orchestrator",
  );
}

async function cloneAndBranch(
  workdir: string,
  repo: string,
  branch: string,
  octokit: Octokit,
): Promise<void> {
  // Use the App-installation token for auth. octokit.auth() returns
  // either a token string or { token } depending on the auth strategy.
  const auth = await octokit.auth();
  const token =
    typeof auth === "string" ? auth : (auth as { token?: string })?.token;
  if (!token) {
    throw new Error("octokit.auth() did not yield a token for clone");
  }
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  await execFile("git", ["clone", "--depth", "1", url, workdir]);
  await execFile("git", ["-C", workdir, "checkout", "-b", branch]);
  await execFile("git", [
    "-C",
    workdir,
    "config",
    "user.email",
    "lore-agent@re-cinq.com",
  ]);
  await execFile("git", [
    "-C",
    workdir,
    "config",
    "user.name",
    "Lore Agent",
  ]);
}

async function pushAndOpenPr(opts: {
  workdir: string;
  repo: string;
  branchName: string;
  task: ProcessTaskViaSupervisorOptions["task"];
  octokit: Octokit;
}): Promise<ProcessTaskViaSupervisorResult> {
  // Did the supervisor produce any commits beyond the initial clone?
  const { stdout: log } = await execFile("git", [
    "-C",
    opts.workdir,
    "log",
    "--oneline",
    "-n",
    "10",
  ]);
  const commitCount = log.trim().split("\n").length;
  if (commitCount <= 1) {
    return { outcome: "no_changes", branchName: opts.branchName };
  }

  await execFile("git", [
    "-C",
    opts.workdir,
    "push",
    "origin",
    opts.branchName,
  ]);

  // Look up issueNumber for the PR footer (it's null for dark-mode
  // tasks that didn't create an Issue).
  const rows = await query<{ issue_number: number | null }>(
    `SELECT issue_number FROM pipeline.tasks WHERE id = $1`,
    [opts.task.id],
  );
  const issueNumber = rows[0]?.issue_number ?? null;

  const [owner, repoName] = opts.repo.split("/");
  const pr = await opts.octokit.rest.pulls.create({
    owner,
    repo: repoName,
    title: `lore: ${opts.task.task_type} — ${opts.branchName.split("/").pop()}`,
    head: opts.branchName,
    base: "main",
    body:
      `## ${opts.task.task_type}\n\n${opts.task.description}\n\n` +
      `**Execution mode:** Dark Factory (in-agent supervisor)\n\n` +
      `Generated by Lore agent task \`${opts.task.id}\`.${prFooter({ issueNumber, taskId: opts.task.id })}`,
  });

  // Update pipeline.tasks with PR info so resolvePrForTask can find it.
  await query(
    `UPDATE pipeline.tasks
        SET status = 'pr-created',
            pr_url = $1,
            pr_number = $2,
            target_branch = $3,
            updated_at = now()
      WHERE id = $4`,
    [pr.data.html_url, pr.data.number, opts.branchName, opts.task.id],
  );

  return {
    outcome: "pr_created",
    prUrl: pr.data.html_url,
    prNumber: pr.data.number,
    branchName: opts.branchName,
  };
}

interface PrForAutoMerge {
  repo: string;
  prNumber: number;
  octokit: Octokit;
  policy: Parameters<typeof evaluateAndMerge>[0]["policy"];
}

async function resolvePrForTaskFromDb(
  taskId: string,
  settings: ResolvedDarkFactorySettings,
  octokit: Octokit,
): Promise<PrForAutoMerge | null> {
  const rows = await query<{
    pr_number: number | null;
    target_repo: string | null;
    target_branch: string | null;
  }>(
    `SELECT pr_number, target_repo, target_branch
       FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );
  const row = rows[0];
  if (!row?.pr_number || !row.target_repo) return null;

  // Look up PR state to populate the auto-merge policy. Best-effort —
  // any failure just defers auto-merge with deferred:api_failure on the
  // call itself.
  const [owner, repoName] = row.target_repo.split("/");
  let ciSucceeded = true;
  let botApproved = true;
  let humanChangesRequested = false;
  let changedPaths: string[] = [];
  try {
    const filesRes = await octokit.rest.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: row.pr_number,
    });
    changedPaths = filesRes.data.map((f) => f.filename);

    const checks = await octokit.rest.checks.listForRef({
      owner,
      repo: repoName,
      ref: row.target_branch ?? `pull/${row.pr_number}/head`,
    });
    ciSucceeded = checks.data.check_runs.every(
      (c) => c.conclusion === "success" || c.conclusion === "skipped",
    );

    const reviews = await octokit.rest.pulls.listReviews({
      owner,
      repo: repoName,
      pull_number: row.pr_number,
    });
    botApproved = reviews.data.some(
      (r) =>
        r.state === "APPROVED" && r.user?.login.endsWith("[bot]"),
    );
    humanChangesRequested = reviews.data.some(
      (r) =>
        r.state === "CHANGES_REQUESTED" && !r.user?.login.endsWith("[bot]"),
    );
  } catch (err) {
    console.warn(
      "[orchestrator] PR state lookup failed; auto-merge will likely defer:",
      (err as Error).message,
    );
  }

  // Look up trust level.
  let trustLevel: ResolvedDarkFactorySettings["auto_merge"]["min_trust"] =
    "docs";
  try {
    const r = await query<{ settings: { trust?: { level?: string } } }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [row.target_repo],
    );
    const lvl = r[0]?.settings?.trust?.level as
      | "docs"
      | "tests"
      | "implementation"
      | "full"
      | undefined;
    if (lvl) trustLevel = lvl;
  } catch {
    // Default already set.
  }

  return {
    repo: row.target_repo,
    prNumber: row.pr_number,
    octokit,
    policy: {
      darkFactoryEnabled: settings.enabled,
      autoMerge: {
        paths: settings.auto_merge.paths,
        min_trust: settings.auto_merge.min_trust,
        require_green_ci: settings.auto_merge.require_green_ci,
        require_bot_approval: settings.auto_merge.require_bot_approval,
      },
      trustLevel,
      changedPaths,
      ciSucceeded,
      botApproved,
      humanChangesRequested,
    },
  };
}
