#!/usr/bin/env node
/**
 * Job pod entry point for dark-factory mode (PR #309).
 *
 * Invoked by `docker/claude-runner/entrypoint.sh` when
 * `LORE_DARK_FACTORY_WORKFLOW` is set on the pod env. Runs the
 * supervisor inside the cloned working tree, walks the workflow
 * graph, and pushes the resulting branch on success. The
 * loretask-watcher then notices the Job complete and creates the PR
 * (preserving today's PR-creation responsibility split).
 *
 * Required env vars:
 *   LORE_DARK_FACTORY_WORKFLOW   workflow name (matches a YAML name field)
 *   LORE_TASK_ID                 task UUID
 *   TARGET_REPO                  "owner/repo"
 *   BRANCH_NAME                  "lore/<task_type>/<slug>"
 *   TASK_DESCRIPTION             task description (raw, used as the prompt input)
 *   TASK_TYPE                    pipeline.tasks.task_type
 *
 * Optional:
 *   LORE_DB_HOST                 if set, supervisor uses DbLeaseBackend; else file-backed
 *   WORKDIR                      git working tree path (default /workspace/repo)
 *   TASK_TYPES_PATH              explicit task-types.yaml path (else /config/task-types.yaml)
 *
 * Exit-code matrix (consumed by entrypoint.sh + loretask-watcher):
 *   0  completed                 supervisor walked the graph to a terminal node
 *   2  not_a_git_workdir         WORKDIR has no .git/
 *   3  workflow_load_failed      loadWorkflowDir threw (yaml parse, missing dir)
 *   4  workflow_not_found        LORE_DARK_FACTORY_WORKFLOW didn't match any name
 *   5  lease_held                another pod owns the branch — exit cleanly
 *   6  iteration_max_exceeded    graph aborted on a back-edge
 *   7  executor_error            handler threw mid-run
 *   8  executor_pending          configuration bug (missing workflow + handlers)
 *   9  env_missing               required env var not set (controller misconfig)
 *
 * Exit 1 is reserved for a Node uncaught exception (rare). Watchers
 * should treat any non-zero as task failure but use the specific code
 * to decide retry vs needs-human-help.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runSupervisor } from "./index.js";
import { loadWorkflowDir, type Workflow } from "../workflow/loader.js";
import { createClaudeCodeAgentHandler } from "./claude-code-handler.js";
import { createProductionHandlers } from "./handlers.js";
import { buildPrompt, getTaskTypeConfig, loadTaskTypes } from "../config.js";
import { initPool } from "../db.js";

class MissingEnvError extends Error {
  constructor(public readonly varName: string) {
    super(`runner-cli: missing required env var ${varName}`);
    this.name = "MissingEnvError";
  }
}

const WORKFLOWS_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "workflows",
);

async function main(): Promise<number> {
  const workflowName = requireEnv("LORE_DARK_FACTORY_WORKFLOW");
  const taskId = requireEnv("LORE_TASK_ID");
  const targetRepo = requireEnv("TARGET_REPO");
  const branchName = requireEnv("BRANCH_NAME");
  const taskDescription = requireEnv("TASK_DESCRIPTION");
  const taskType = requireEnv("TASK_TYPE");
  const workdir = process.env.WORKDIR || "/workspace/repo";

  console.log(`[runner-cli] Starting dark-factory supervisor`);
  console.log(`[runner-cli]   task_id     = ${taskId}`);
  console.log(`[runner-cli]   workflow    = ${workflowName}`);
  console.log(`[runner-cli]   target_repo = ${targetRepo}`);
  console.log(`[runner-cli]   branch      = ${branchName}`);
  console.log(`[runner-cli]   workdir     = ${workdir}`);

  // Verify the workdir is a git working tree before we hand off to the
  // supervisor — the executor's `git -C` calls assume this.
  try {
    await fs.access(path.join(workdir, ".git"));
  } catch {
    console.error(`[runner-cli] ${workdir} is not a git working tree`);
    return 2;
  }

  // task-types.yaml resolution — pass an explicit path so we don't
  // rely on cwd-relative fallbacks, which won't resolve inside the
  // /workspace/repo working tree of the target repo. Defaults to the
  // image mount path /config/task-types.yaml; overridable via
  // TASK_TYPES_PATH for local runs.
  const taskTypesPath =
    process.env.TASK_TYPES_PATH || "/config/task-types.yaml";
  loadTaskTypes(taskTypesPath);

  // DB pool optional. When LORE_DB_HOST is set, the supervisor uses
  // DbLeaseBackend (correct for cluster pods); otherwise falls back to
  // file-backed lease in the workdir's parent.
  if (process.env.LORE_DB_HOST) {
    initPool();
  }

  let workflows: Map<string, Workflow>;
  try {
    workflows = await loadWorkflowDir(WORKFLOWS_DIR);
  } catch (err) {
    console.error(`[runner-cli] Failed to load workflows: ${(err as Error).message}`);
    return 3;
  }

  const workflow = workflows.get(workflowName);
  if (!workflow) {
    console.error(
      `[runner-cli] Workflow "${workflowName}" not found. Available: ${[...workflows.keys()].join(", ")}`,
    );
    return 4;
  }

  const agentHandler = createClaudeCodeAgentHandler(
    {
      resolvePrompt: (promptRef, description) => {
        const config = getTaskTypeConfig(promptRef);
        if (!config) return null;
        return buildPrompt(promptRef, description);
      },
    },
    { taskId, description: taskDescription, taskType },
  );

  const handlers = createProductionHandlers({
    agent: agentHandler,
    // Auto-merge intentionally NOT wired here — the loretask-watcher
    // owns PR creation, and firing evaluateAndMerge from inside the
    // pod would race the watcher (the PR doesn't exist yet at this
    // point in the workflow). Instead, the watcher's PR-created
    // branch calls `tryAutoMergeForCompletedTask` (see
    // jobs/auto-merge-trigger.ts → jobs/loretask-watcher.ts), so cluster-path
    // PRs auto-merge under the same policy as the in-agent path
    // (gap-fill / runbook). Per ADR-016.
    episodeDeps: { curate: false },
  });

  const result = await runSupervisor({
    taskId,
    branchName,
    workflowName,
    gitDir: workdir,
    workflow,
    handlers,
  });

  console.log(
    `[runner-cli] Supervisor exited reason=${result.reason} ranWork=${result.ranWork}`,
  );
  if (result.summary) {
    console.log(
      `[runner-cli] visited: ${result.summary.visited.map((v) => `${v.nodeId}:${v.outcome}`).join(", ")}`,
    );
  }

  switch (result.reason) {
    case "completed":
      return 0;
    case "lease_held":
      return 5; // another pod claimed this branch — exit cleanly
    case "iteration_max_exceeded":
      return 6; // graph aborted; loretask-watcher handles needs-human-help
    case "executor_error":
      console.error(`[runner-cli] executor error: ${result.errorMessage}`);
      return 7;
    case "executor_pending":
      // Should not happen in production; means workflow + handlers
      // weren't supplied. Fall through as failure.
      console.error(
        `[runner-cli] executor_pending — workflow + handlers not configured`,
      );
      return 8;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new MissingEnvError(name);
  }
  return v;
}

/**
 * Realpath-based comparison so the script still self-executes when
 * invoked via a symlink (e.g. /usr/local/bin/lore-runner →
 * /app/dist/supervisor/runner-cli.js). String compare on
 * `import.meta.url` against `process.argv[1]` would skip main() in
 * that case.
 */
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const here = realpathSync(fileURLToPath(import.meta.url));
    const argv = realpathSync(process.argv[1]);
    return here === argv;
  } catch {
    return false;
  }
}

// Only exec when invoked as a script. Allows the file to be imported
// (and unit-tested) without immediately running main().
if (isMainModule()) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      if (err instanceof MissingEnvError) {
        console.error(`[runner-cli] ${err.message}`);
        process.exit(9);
      }
      console.error(`[runner-cli] fatal: ${(err as Error).message}`);
      process.exit(1);
    });
}

export { main, MissingEnvError };
