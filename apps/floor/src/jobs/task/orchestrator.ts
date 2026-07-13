import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ResolvedDarkFactorySettings } from "@re-cinq/lore-shared";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { assemblyLines } from "../../kernel/queues.js";
import { Llm } from "@re-cinq/lore-shared";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import {
  gitAuthArgs,
  repoCloneUrl,
} from "@re-cinq/lore-shared/project/workspace/git-auth.js";
import { generateArtifactCopy } from "../lib/artifact-copy.js";
import { linkifyMarkdown } from "@re-cinq/lore-shared";
import { slugify } from "./task-helpers.js";
import { projectFor } from "../../composition/project-boot.js";
import { taskStore } from "../../kernel/queues.js";
import {
  writeEpisode,
  writeEpisodeWithCuration,
} from "../lib/episode-writer.js";
import {
  evaluateAndMerge,
  type AutoMergeJobInputs,
} from "../merge/auto-merge.js";
import { resolvePrForTaskFromDb } from "../platform/pr-policy.js";
import { prFooter } from "@re-cinq/lore-shared";
import { escalate } from "../platform/escalation.js";
import { writeAuditLog } from "../lib/audit.js";
import { leaseBackendForEnv } from "../../main-loop/lease/lease-backend.js";
import {
  runSupervisor,
  loadBuiltinAssemblyLines,
  createAgentHandler,
  createProductionHandlers,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { buildPrompt, getTaskTypeConfig } from "../../kernel/config.js";

const execFile = promisify(execFileCb);

/**
 * In-agent task processor for dark-mode tasks (T058 follow-up). When a
 * pipeline task lands on a repo with `dark_factory.enabled = true` and
 * an assembly line exists for the task type, the worker dispatches here
 * instead of handing off to the LoreTask CRD path. Limited in scope
 * to JSON-output assembly lines (gap-fill, runbook); Claude-Code-driven
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
  /** The per-attempt id minted by project.assemblyLines.start(); the caller
   *  (the assembly_line.start handler) owns the row lifecycle. */
  assemblyLineId: string;
  /** Override for tests — defaults to the runner's bundled assembly lines. */
  loadAssemblyLines?: () => Promise<Map<string, AssemblyLine>>;
  /** Override for tests — node-trace sink target; defaults to the pooled PgAssemblyLines singleton. */
  assemblyLinesPort?: AssemblyLinesPort;
  /** Override for tests — mints the GitHub App installation token for clone/push.
   *  Defaults to the shared PlatformGitHub. */
  gitToken?: () => Promise<string>;
  /** Override for tests — defaults to using a tmpdir under `os.tmpdir()`. */
  workdir?: string;
}

/** Default clone/push credential: a fresh GitHub App installation token. */
const defaultGitToken = (): Promise<string> =>
  new PlatformGitHub(process.env).getInstallationToken();

export interface ProcessTaskViaSupervisorResult {
  outcome:
    "pr_created" | "no_changes" | "lease_held" | "iteration_max" | "error";
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  errorMessage?: string;
}

/**
 * Maps task_type → assembly line name. The assembly line YAML's `name` field is
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
  return `lore/${task.task_type}/${slugify(task.description)}-${task.id.slice(0, 8)}`;
}

export async function processTaskViaSupervisor(
  opts: ProcessTaskViaSupervisorOptions,
): Promise<ProcessTaskViaSupervisorResult> {
  const { task, settings } = opts;
  const branchName = opts.branchName ?? buildBranchName(task);

  const definitions = await (
    opts.loadAssemblyLines ?? loadBuiltinAssemblyLines
  )();
  const assemblyLine = definitions.get(task.task_type);
  if (!assemblyLine) {
    return {
      outcome: "error",
      errorMessage: `no assembly line defined for task type "${task.task_type}"`,
    };
  }

  const gitToken = opts.gitToken ?? defaultGitToken;
  const workdir =
    opts.workdir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), `lore-supervisor-${task.id}-`)));

  const cleanupWorkdir = !opts.workdir; // only delete what we created

  // The assembly_line.start handler owns the pipeline.assembly_lines row
  // lifecycle; this path only traces node executions into it.
  const assemblyLinesPort = opts.assemblyLinesPort ?? assemblyLines();
  const assemblyLineId = opts.assemblyLineId;

  try {
    await cloneAndBranch(workdir, task.target_repo, branchName, gitToken);

    const agentHandler = createAgentHandler(
      {
        callLLM: (params) => Llm.instance.complete(params),
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
        // The kernel types `policy` opaquely; the real engine expects
        // AutoMergeJobInputs, so cast at this boundary.
        evaluateAndMerge: (i) => evaluateAndMerge(i as AutoMergeJobInputs),
        resolvePrForTask: async (taskId) =>
          await resolvePrForTaskFromDb(taskId, settings),
      },
    });

    const result = await runSupervisor({
      taskId: task.id,
      assemblyLineId,
      branchName,
      gitDir: workdir,
      assemblyLine,
      handlers,
      trace: {
        onNodeStart: (i) => assemblyLinesPort.recordNodeStart(i),
        onNodeFinish: (ref, outcome, sha) =>
          assemblyLinesPort.recordNodeFinish(ref, outcome, sha),
      },
      leaseBackend: leaseBackendForEnv(),
      audit: process.env.LORE_DB_HOST ? { write: writeAuditLog } : undefined,
      // FR3.8 / T040: a stuck task must produce a needs-human-help
      // Issue + Slack ping with full context. Wired here so the
      // dark-factory dispatch path doesn't lose the escalation hook.
      onIterationMaxExceeded: async (info) => {
        await escalate({
          taskId: info.taskId,
          repo: task.target_repo,
          branchName: info.branchName,
          reason: "iteration_max_exceeded",
          diagnostic:
            `AssemblyLine ${info.assemblyLineName} exceeded iteration_max=${info.iterationMax} ` +
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
      gitToken,
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
  getToken: () => Promise<string>,
): Promise<void> {
  // The token rides in a per-invocation http.extraheader (shared gitAuthArgs),
  // never baked into `.git/config` or the clone URL where it would persist for
  // the workdir's lifetime and leak into logs that echo the remote.
  const token = await getToken();
  await execFile("git", [
    ...gitAuthArgs(token),
    "clone",
    "--depth",
    "1",
    repoCloneUrl(repo),
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
  await execFile("git", ["-C", workdir, "config", "user.name", "Lore Agent"]);
}

/**
 * Push helper — same gitAuthArgs extraheader as cloneAndBranch so the token
 * never lives in `.git/config`. Token is fetched fresh each time (App
 * installation tokens have ~1h TTL but are cheap to re-mint).
 */
async function pushBranch(
  workdir: string,
  repo: string,
  branch: string,
  getToken: () => Promise<string>,
): Promise<void> {
  const token = await getToken();
  await execFile("git", [
    "-C",
    workdir,
    ...gitAuthArgs(token),
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
  gitToken: () => Promise<string>;
}): Promise<ProcessTaskViaSupervisorResult> {
  const project = await projectFor(opts.repo);

  // Look up the repo's actual default branch (master / main / develop /
  // trunk — varies). Used for the no-changes diff check and the PR
  // base. Hardcoding "main" 422'd on repos that hadn't switched.
  const defaultBranch = await project.repo.defaultBranch();

  // Real change detection: compare HEAD to the upstream default branch
  // via diff, not commit count. Stage commits include intentional
  // empty commits (validate / gate / retrospective per FR1.3), so a
  // assembly line that runs to completion without producing file changes
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

  await pushBranch(opts.workdir, opts.repo, opts.branchName, opts.gitToken);

  // Look up issueNumber for the PR footer (it's null for dark-mode
  // tasks that didn't create an Issue).
  const taskRow = await taskStore().getById(opts.task.id);
  const issueNumber = taskRow?.issue_number ?? null;

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
  // Pass [] labels explicitly: the raw pulls.create added none, while the facade
  // defaults to ["agent-generated"] — keep the historical behavior.
  const pr = await project.pulls.open(
    opts.branchName,
    copy.title,
    `${body}${prFooter({ issueNumber, taskId: opts.task.id })}`,
    defaultBranch,
    [],
  );

  // Update pipeline.tasks with PR info so resolvePrForTask can find it.
  await taskStore().setStatus(opts.task.id, "pr-created", {
    pr_url: pr.url,
    pr_number: pr.number,
    target_branch: opts.branchName,
  });

  return {
    outcome: "pr_created",
    prUrl: pr.url,
    prNumber: pr.number,
    branchName: opts.branchName,
  };
}

// PrForAutoMerge + resolvePrForTaskFromDb + buildOctokit moved to
// `agent/src/lib/pr-policy.ts` so the loretask-watcher (cluster path)
// and this orchestrator (in-agent path) share the same policy build.
