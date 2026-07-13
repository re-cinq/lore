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
  loadBuiltinAssemblyLines,
  type AssemblyLine,
  type AssemblyLineTrace,
  type SupervisorResult,
  type AgentNodeStatus,
  type CiConclusion,
} from "@re-cinq/lore-assembly-lines";
import type { LeaseBackend, LoreTaskSpec, StationBackend } from "@re-cinq/lore-shared";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { nodeAgentName } from "./floor-assembly-line.js";
import {
  buildFloorAssemblyLineHandlers,
  type FloorAssemblyLineTask,
  type FloorAssemblyLinePorts,
} from "./floor-assembly-line.js";
import { KubeAgentApi } from "../station/kube-agent-api.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { gitAuthArgs, repoCloneUrl } from "@re-cinq/lore-shared/project/workspace/git-auth.js";
import { buildPrompt } from "../../kernel/config.js";
import { writeEpisode, writeEpisodeWithCuration } from "../lib/episode-writer.js";
import { leaseBackendForEnv } from "../../main-loop/lease/lease-backend.js";
import { assemblyLines } from "../../kernel/queues.js";

const execFile = promisify(execFileCb);

export interface RunFloorAssemblyLineOptions {
  task: FloorAssemblyLineTask;
  assemblyLine: AssemblyLine;
  /** A checked-out working tree on the task's branch (stage commits + resume land here). */
  gitDir: string;
  holder: string;
  leaseBackend: LeaseBackend;
  ports: FloorAssemblyLinePorts;
  /** Per-node observability sink (pipeline.assembly_line_nodes); optional in tests. */
  trace?: AssemblyLineTrace;
}

/** Walk one task's assembly line Floor-side. Thin by design: it wires the Floor handlers
 *  (buildFloorAssemblyLineHandlers) into runSupervisor, which owns the lease + branch-as-state +
 *  resume. Everything cluster-shaped is in `ports`, so this runs unchanged in the local
 *  integration test (fake ports) and in production (real ports). */
export function runFloorAssemblyLine(opts: RunFloorAssemblyLineOptions): Promise<SupervisorResult> {
  return runSupervisor({
    taskId: opts.task.taskId,
    assemblyLineId: opts.task.assemblyLineId,
    branchName: opts.task.branch,
    gitDir: opts.gitDir,
    holder: opts.holder,
    leaseBackend: opts.leaseBackend,
    assemblyLine: opts.assemblyLine,
    handlers: buildFloorAssemblyLineHandlers(opts.task, opts.ports),
    trace: opts.trace,
  });
}

/** Adapt the shared AssemblyLinesPort as the executor's trace sink. The port's node rows
 *  get the CR name pre-computed from the same (assemblyLineId, nodeId) keying dispatch uses. */
export function portTrace(port: AssemblyLinesPort): AssemblyLineTrace {
  return {
    onNodeStart: (i) =>
      port.recordNodeStart({ ...i, agentCrName: nodeAgentName(i.assemblyLineId, i.nodeId) }),
    onNodeFinish: (nodeRef, outcome, commitSha) =>
      port.recordNodeFinish(nodeRef, outcome, commitSha),
  };
}

/** Map the supervisor's terminal reason onto the assembly line row's outcome vocabulary. */
export function supervisorOutcome(result: SupervisorResult): string {
  switch (result.reason) {
    case "completed":
      return "completed";
    case "lease_held":
      return "lease_held";
    case "iteration_max_exceeded":
      return "iteration_max";
    case "executor_pending":
      return "pending";
    default:
      return "error";
  }
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
  /** pipeline.assembly_lines record + node trace (InMemoryAssemblyLines in tests). */
  assemblyLines: AssemblyLinesPort;
  /** Credential-free clone URL + per-invocation git auth args (token via extraheader,
   *  never in the URL or `.git/config`). The token is minted per call. */
  cloneAuth: (repo: string) => Promise<{ url: string; authArgs: string[] }>;
}

/** Clone the task's working tree for the stage-commit state: resume the branch if it
 *  already exists, otherwise bootstrap it off the default — a task's first run has no
 *  branch yet, so `clone --branch <missing>` would die with "Remote branch not found".
 *  `authArgs` carries the token as an http.extraheader override (empty for a local
 *  bare-repo path in tests). */
export async function checkoutBranch(
  repo: string,
  branch: string,
  url: string,
  authArgs: string[] = [],
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `lore-assembly-line-${repo.replace("/", "-")}-`));
  await execFile("git", [...authArgs, "clone", url, dir]);
  try {
    await execFile("git", ["-C", dir, "checkout", branch]);
  } catch {
    await execFile("git", ["-C", dir, "checkout", "-b", branch]);
  }
  return dir;
}

/** Production entrypoint (invoked by the assembly_line.start handler, which owns the
 *  pipeline.assembly_lines row lifecycle): clone the branch, build real ports, run the
 *  assembly line with node tracing, clean up. */
export async function runFloorAssemblyLineForTask(
  task: FloorAssemblyLineTask,
  rt: FloorAssemblyLineRuntime,
): Promise<SupervisorResult> {
  const definitions = await loadBuiltinAssemblyLines();
  const assemblyLine = definitions.get(task.taskType);
  if (!assemblyLine) {
    throw new Error(`No assembly line defined for task type "${task.taskType}"`);
  }
  const holder = os.hostname();
  const { url, authArgs } = await rt.cloneAuth(task.targetRepo);
  const gitDir = await checkoutBranch(task.targetRepo, task.branch, url, authArgs);
  try {
    const ports: FloorAssemblyLinePorts = {
      dispatchAgent: async (spec) => {
        await rt.dispatcher.launch(spec);
      },
      resolvePrompt: (node, t) => rt.resolvePrompt(node.prompt_ref ?? node.type, t.description),
      agentStatus: (assemblyLineId, nodeId) => rt.status.read(nodeAgentName(assemblyLineId, nodeId)),
      ciConclusion: (branch) => rt.ciConclusion(task.targetRepo, branch),
      // Extra heartbeat during a long node poll, between executeAssemblyLine's per-node refreshes
      // — same (branch, holder, nodeId) the executor uses.
      heartbeat: async (branchName, nodeId) => {
        await rt.leaseBackend.refresh(branchName, holder, undefined, nodeId);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      episodeDeps: rt.episodeDeps,
    };
    return await runFloorAssemblyLine({
      task,
      assemblyLine,
      gitDir,
      holder,
      leaseBackend: rt.leaseBackend,
      ports,
      trace: portTrace(rt.assemblyLines),
    });
  } finally {
    await fs.rm(gitDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Assemble the real ports for a Floor-side assembly line run: dispatch via the agent-cr backend,
 *  per-node Agent-status reads, GitHub CI, prompt resolution, the DB lease, episode
 *  writers, and a token-bearing clone URL. IO shell — verified by the minikube smoke. */
export function floorAssemblyLineRuntime(dispatcher: StationBackend): FloorAssemblyLineRuntime {
  const kubeApi = new KubeAgentApi();
  const gh = new PlatformGitHub(process.env);
  return {
    dispatcher: { launch: (spec) => dispatcher.launch(spec) },
    status: { read: (name) => kubeApi.getStatus(name) },
    ciConclusion: (repo, ref) => gh.ciConclusion(repo, ref),
    resolvePrompt: (promptRef, description) => buildPrompt(promptRef, description),
    leaseBackend: leaseBackendForEnv(),
    episodeDeps: { writeEpisode, writeEpisodeWithCuration, curate: true },
    assemblyLines: assemblyLines(),
    // Token rides in authArgs (extraheader), not the URL — no leak into .git/config.
    cloneAuth: async (repo) => ({
      url: repoCloneUrl(repo),
      authArgs: gitAuthArgs(await gh.getInstallationToken()),
    }),
  };
}
