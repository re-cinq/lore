import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "octokit";
import type { ResolvedDarkFactorySettings } from "@re-cinq/lore-shared";
import { callLLM } from "../anthropic.js";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import { query } from "../db.js";
import { writeEpisode, writeEpisodeWithCuration } from "../lib/episode-writer.js";
import { evaluateAndMerge } from "../jobs/auto-merge.js";
import {
  buildOctokit,
  resolvePrForTaskFromDb,
  type PrForAutoMerge,
} from "../lib/pr-policy.js";
import { prFooter } from "../lib/pr-body.js";
import { escalate } from "../lib/escalation.js";
import { runSupervisor } from "./index.js";
import { loadWorkflowDir, type Workflow } from "../workflow/loader.js";
import { createAgentHandler } from "./agent-handler.js";
import { createProductionHandlers } from "./handlers.js";
import { buildPrompt, getTaskTypeConfig } from "../config.js";

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
  /**
   * Branch name supplied by the caller (worker.ts). Revision tasks
   * carry a non-default branch in `contextBundle.branch` so the
   * supervisor lands on the same branch and resumes from the prior
   * stage commits. Falls back to a derived `lore/<type>/<slug>-<id8>`
   * when omitted (greenfield tasks).
   */
  branchName?: string;
  /** Override for tests — defaults to load from `agent/src/workflows/`. */
  loadWorkflows?: (dir: string) => Promise<Map<string, Workflow>>;
  /** Override for tests — defaults to constructing an Octokit. */
  octokit?: Octokit;
  /** Override for tests — defaults to using a tmpdir under `os.tmpdir()`. */
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

export function buildBranchName(task: {
  id: string;
  description: string;
  task_type: string;
}): string {
  const slug = task.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return `lore/${task.task_type}/${slug}-${task.id.slice(0, 8)}`;
}

export async function processTaskViaSupervisor(
  opts: ProcessTaskViaSupervisorOptions,
): Promise<ProcessTaskViaSupervisorResult> {
  const { task, settings } = opts;
  const branchName = opts.branchName ?? buildBranchName(task);

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

  const cleanupWorkdir = !opts.workdir; // only delete what we created

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
      // FR3.8 / T040: a stuck task must produce a needs-human-help
      // Issue + Slack ping with full context. Wired here so the
      // dark-factory dispatch path doesn't lose the escalation hook.
      onIterationMaxExceeded: async (info) => {
        await escalate({
          octokit,
          taskId: info.taskId,
          repo: task.target_repo,
          branchName: info.branchName,
          reason: "iteration_max_exceeded",
          diagnostic:
            `Workflow ${info.workflowName} exceeded iteration_max=${info.iterationMax} ` +
            `on back-edge ${info.fromNode} → ${info.toNode}`,
        });
      },
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
      await fs
        .rm(workdir, { recursive: true, force: true })
        .catch((err) =>
          console.warn(
            `[orchestrator] workdir cleanup failed for ${workdir}:`,
            (err as Error).message,
          ),
        );
    }
  }
}

async function cloneAndBranch(
  workdir: string,
  repo: string,
  branch: string,
  octokit: Octokit,
): Promise<void> {
  const auth = await octokit.auth();
  const token =
    typeof auth === "string" ? auth : (auth as { token?: string })?.token;
  if (!token) {
    throw new Error("octokit.auth() did not yield a token for clone");
  }
  // Avoid baking the token into `.git/config` (which would persist for
  // the workdir's lifetime and risk leaking into logs that echo URLs).
  // Pass the credential as a per-invocation `http.extraheader` config
  // override; never stored on disk in cleartext.
  const headerValue = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const repoUrl = `https://github.com/${repo}.git`;
  const authConfig = [
    "-c",
    `http.https://github.com/.extraheader=${headerValue}`,
  ];

  await execFile("git", [
    ...authConfig,
    "clone",
    "--depth",
    "1",
    repoUrl,
    workdir,
  ]);
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

/**
 * Push helper — reuses the same `http.extraheader` pattern as
 * cloneAndBranch so the token never lives in `.git/config`. Token is
 * fetched fresh each time (App installation tokens have ~1h TTL but
 * are cheap to re-mint).
 */
async function pushBranch(
  workdir: string,
  repo: string,
  branch: string,
  octokit: Octokit,
): Promise<void> {
  const auth = await octokit.auth();
  const token =
    typeof auth === "string" ? auth : (auth as { token?: string })?.token;
  if (!token) throw new Error("octokit.auth() did not yield a token for push");
  const headerValue = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  await execFile("git", [
    "-C",
    workdir,
    "-c",
    `http.https://github.com/.extraheader=${headerValue}`,
    "push",
    "origin",
    branch,
  ]);
}

async function pushAndOpenPr(opts: {
  workdir: string;
  repo: string;
  branchName: string;
  task: ProcessTaskViaSupervisorOptions["task"];
  octokit: Octokit;
}): Promise<ProcessTaskViaSupervisorResult> {
  const [owner, repoName] = opts.repo.split("/");

  // Look up the repo's actual default branch (master / main / develop /
  // trunk — varies). Used for the no-changes diff check and the PR
  // base. Hardcoding "main" 422'd on repos that hadn't switched.
  const repoMeta = await opts.octokit.rest.repos.get({
    owner,
    repo: repoName,
  });
  const defaultBranch = repoMeta.data.default_branch;

  // Real change detection: compare HEAD to the upstream default branch
  // via diff, not commit count. Stage commits include intentional
  // empty commits (validate / gate / retrospective per FR1.3), so a
  // workflow that runs to completion without producing file changes
  // still has commitCount > 1. `git diff --shortstat` against the
  // default branch returns "" iff no real diff exists.
  await execFile("git", [
    "-C",
    opts.workdir,
    "fetch",
    "origin",
    defaultBranch,
    "--depth",
    "1",
  ]);
  const { stdout: shortstat } = await execFile("git", [
    "-C",
    opts.workdir,
    "diff",
    "--shortstat",
    `origin/${defaultBranch}...HEAD`,
  ]);
  if (shortstat.trim() === "") {
    return { outcome: "no_changes", branchName: opts.branchName };
  }

  await pushBranch(opts.workdir, opts.repo, opts.branchName, opts.octokit);

  // Look up issueNumber for the PR footer (it's null for dark-mode
  // tasks that didn't create an Issue).
  const rows = await query<{ issue_number: number | null }>(
    `SELECT issue_number FROM pipeline.tasks WHERE id = $1`,
    [opts.task.id],
  );
  const issueNumber = rows[0]?.issue_number ?? null;

  const copy = await generateArtifactCopy({
    kind: "pr",
    taskType: opts.task.task_type,
    description: opts.task.description,
    repo: opts.repo,
  });

  const body = linkifyMarkdown(copy.body, {
    repo: opts.repo,
    branch: opts.branchName,
    uiUrl: process.env.LORE_UI_URL,
  });
  const pr = await opts.octokit.rest.pulls.create({
    owner,
    repo: repoName,
    title: copy.title,
    head: opts.branchName,
    base: defaultBranch,
    body: `${body}${prFooter({ issueNumber, taskId: opts.task.id })}`,
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

// PrForAutoMerge + resolvePrForTaskFromDb + buildOctokit moved to
// `agent/src/lib/pr-policy.ts` so the loretask-watcher (cluster path)
// and this orchestrator (in-agent path) share the same policy build.
