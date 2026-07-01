// Floor-side assembly-line driver — IO entrypoint (ADR-031 D4, #686 Wave 2). Runs the
// assembly line Floor-side: each agent-node dispatches its own Agent CR, github_action
// nodes gate on CI, and the branch-as-state stage commits + resume happen via local git
// in `gitDir`. `runFloorAssemblyLine` is the orchestrator (driven locally by the integration
// test with a temp git repo + FileLeaseBackend + fake ports); the composition root below
// backs the ports with real dispatch/poll/CI/clone and is exercised by the minikube
// smoke test (runbooks/floor-assembly-line-minikube-smoke.md).

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  runSupervisor,
  loadBuiltinWorkflows,
  type Workflow,
  type SupervisorResult,
  type AgentNodeStatus,
  type CiConclusion,
} from "@re-cinq/lore-runner";
import type { LeaseBackend, LoreTaskSpec, StationBackend } from "@re-cinq/lore-shared";
import {
  buildFloorAssemblyLineHandlers,
  type FloorAssemblyLineTask,
  type FloorAssemblyLinePorts,
} from "./floor-assembly-line.js";
import { KubeAgentApi } from "../station/kube-agent-api.js";
import { GitHubPlatform } from "../platform/github.js";
import { buildPrompt } from "../../kernel/config.js";
import { writeEpisode, writeEpisodeWithCuration } from "../memory/episode-writer.js";
import { leaseBackendForEnv } from "../../main-loop/lease/lease-backend.js";

const execFile = promisify(execFileCb);

export interface RunFloorAssemblyLineOptions {
  task: FloorAssemblyLineTask;
  workflow: Workflow;
  /** A checked-out working tree on the task's branch (stage commits + resume land here). */
  gitDir: string;
  holder: string;
  leaseBackend: LeaseBackend;
  ports: FloorAssemblyLinePorts;
}

/** Walk one task's assembly line Floor-side. Thin by design: it wires the Floor handlers
 *  (buildFloorAssemblyLineHandlers) into runSupervisor, which owns the lease + branch-as-state +
 *  resume. Everything cluster-shaped is in `ports`, so this runs unchanged in the local
 *  integration test (fake ports) and in production (real ports). */
export function runFloorAssemblyLine(opts: RunFloorAssemblyLineOptions): Promise<SupervisorResult> {
  return runSupervisor({
    taskId: opts.task.taskId,
    branchName: opts.task.branch,
    workflowName: opts.workflow.name,
    gitDir: opts.gitDir,
    holder: opts.holder,
    leaseBackend: opts.leaseBackend,
    workflow: opts.workflow,
    handlers: buildFloorAssemblyLineHandlers(opts.task, opts.ports),
  });
}

// ───────────────────────── composition root (IO shell) ─────────────────────────
// Not in the coverage allowlist; verified by the minikube smoke test. Backs the ports
// with real dispatch (AgentCrBackend), per-node Agent-status reads, project CI, and a
// local clone of the branch for the stage-commit working tree.

/** Reads one Agent CR's status by name (the per-node Agent, `<id8>-<nodeId>`). */
export interface AgentStatusReader {
  read: (name: string) => Promise<AgentNodeStatus | null>;
}

/** Dispatches one node's Agent CR (AgentCrBackend.launch). */
export interface AgentDispatcher {
  launch: (spec: LoreTaskSpec) => Promise<unknown>;
}

export interface FloorAssemblyLineRuntime {
  dispatcher: AgentDispatcher;
  status: AgentStatusReader;
  ciConclusion: (repo: string, branch: string) => Promise<CiConclusion>;
  resolvePrompt: (promptRef: string, description: string) => string;
  leaseBackend: LeaseBackend;
  episodeDeps: FloorAssemblyLinePorts["episodeDeps"];
  /** GitHub token-bearing clone URL for the task's repo (the token is minted per call). */
  cloneUrl: (repo: string) => Promise<string>;
}

/** Clone the task's working tree for the stage-commit state: resume the branch if it
 *  already exists, otherwise bootstrap it off the default — a task's first run has no
 *  branch yet, so `clone --branch <missing>` would die with "Remote branch not found". */
export async function checkoutBranch(repo: string, branch: string, cloneUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `lore-assembly-line-${repo.replace("/", "-")}-`));
  await execFile("git", ["clone", cloneUrl, dir]);
  try {
    await execFile("git", ["-C", dir, "checkout", branch]);
  } catch {
    await execFile("git", ["-C", dir, "checkout", "-b", branch]);
  }
  return dir;
}

/** Production entrypoint: clone the branch, build real ports, run the assembly line, clean up.
 *  Invocation is gated by the cutover rollout (#688); this is the wiring it flips on. */
export async function runFloorAssemblyLineForTask(
  task: FloorAssemblyLineTask,
  rt: FloorAssemblyLineRuntime,
): Promise<SupervisorResult> {
  const workflows = await loadBuiltinWorkflows();
  const workflow = workflows.get(task.taskType);
  if (!workflow) {
    throw new Error(`No workflow for task type "${task.taskType}"`);
  }
  const holder = os.hostname();
  const gitDir = await checkoutBranch(task.targetRepo, task.branch, await rt.cloneUrl(task.targetRepo));
  try {
    const ports: FloorAssemblyLinePorts = {
      dispatchAgent: async (spec) => {
        await rt.dispatcher.launch(spec);
      },
      resolvePrompt: (node, t) => rt.resolvePrompt(node.prompt_ref ?? node.type, t.description),
      agentStatus: (taskId, nodeId) => rt.status.read(`${taskId.substring(0, 8)}-${nodeId}`),
      ciConclusion: (branch) => rt.ciConclusion(task.targetRepo, branch),
      // Extra heartbeat during a long node poll, between executeAssemblyLine's per-node refreshes
      // — same (branch, holder, nodeId) the executor uses.
      heartbeat: async (branchName, nodeId) => {
        await rt.leaseBackend.refresh(branchName, holder, undefined, nodeId);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      episodeDeps: rt.episodeDeps,
    };
    return await runFloorAssemblyLine({ task, workflow, gitDir, holder, leaseBackend: rt.leaseBackend, ports });
  } finally {
    await fs.rm(gitDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Assemble the real ports for a Floor-side assembly line run: dispatch via the agent-cr backend,
 *  per-node Agent-status reads, GitHub CI, prompt resolution, the DB lease, episode
 *  writers, and a token-bearing clone URL. IO shell — verified by the minikube smoke. */
export function floorAssemblyLineRuntime(dispatcher: StationBackend): FloorAssemblyLineRuntime {
  const kubeApi = new KubeAgentApi();
  const gh = new GitHubPlatform();
  return {
    dispatcher: { launch: (spec) => dispatcher.launch(spec) },
    status: { read: (name) => kubeApi.getStatus(name) },
    ciConclusion: (repo, ref) => gh.ciConclusion(repo, ref),
    resolvePrompt: (promptRef, description) => buildPrompt(promptRef, description),
    leaseBackend: leaseBackendForEnv(),
    episodeDeps: { writeEpisode, writeEpisodeWithCuration, curate: true },
    cloneUrl: async (repo) =>
      `https://x-access-token:${await gh.getInstallationToken()}@github.com/${repo}.git`,
  };
}
