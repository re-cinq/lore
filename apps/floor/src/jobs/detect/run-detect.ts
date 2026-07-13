// Repo-less assembly-line runner for detection lines (spec-drift, gap-detect,
// spec-coverage-validate, spec-coverage-backfill). No clone, no PR: the walk
// runs against an empty tmpdir with a no-op stage-commit writer, and the
// branch name is a pure lease key. Each run writes a `<job_ref>:<repo>`
// pipeline.job_runs row (parity with the retired K8s CronJobs; suffixed so the
// cron emitter's bare-name catch-up marker stays untouched).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  builtinHandlers,
  createStationNodeHandler,
  loadBuiltinAssemblyLines,
  runSupervisor,
  type AssemblyLine,
  type AgentNodeStatus,
  type SupervisorResult,
} from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { JobRunsPort } from "@re-cinq/lore-shared/project/job-runs/job-runs-port.js";
import type { LeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";
import {
  nodeAgentName,
  nodeStationSpec,
} from "../assembly-line/floor-assembly-line.js";

/** Dispatches one node's Agent CR (AgentCrBackend.launch); reads its status by CR name. */
export interface DetectStationDispatch {
  launch: (spec: LoreTaskSpec) => Promise<unknown>;
  status: (crName: string) => Promise<AgentNodeStatus | null>;
}

export interface RunDetectOptions {
  /** The pipeline.assembly_lines row minted by assemblyLines().start(). */
  assemblyLineId: string;
  definitionName: string;
  repo: string;
  /** Overrides for tests; production defaults resolve lazily in runDetect. */
  loadAssemblyLines?: () => Promise<Map<string, AssemblyLine>>;
  assemblyLinesPort?: AssemblyLinesPort;
  jobRunsPort?: JobRunsPort;
  leaseBackend?: LeaseBackend;
  /** Station dispatch (Agent CR launch + status). Defaults to the agent-cr backend. */
  dispatch?: DetectStationDispatch;
}

export function detectBranchName(definitionName: string, repo: string): string {
  return `detect/${definitionName}/${repo}`;
}

/** The detect node's job_ref — the job-run name prefix and registry key. */
function jobRefOf(assemblyLine: AssemblyLine): string {
  const detectNode = assemblyLine.nodes.find((n) => n.type === "detect");
  enforceTrue(
    typeof detectNode?.job_ref === "string" && detectNode.job_ref.length > 0,
    `assembly line "${assemblyLine.name}" has no detect node with job_ref`,
  );
  return detectNode.job_ref;
}

export async function runDetect(
  opts: RunDetectOptions,
): Promise<SupervisorResult> {
  const [assemblyLinesPort, jobRunsPort, leaseBackend, dispatch] =
    await Promise.all([
      opts.assemblyLinesPort ??
        import("../../kernel/queues.js").then((m) => m.assemblyLines()),
      opts.jobRunsPort ??
        import("../../kernel/queues.js").then((m) => m.jobRuns()),
      opts.leaseBackend ??
        import("../../main-loop/lease/lease-backend.js").then((m) =>
          m.leaseBackendForEnv(),
        ),
      opts.dispatch ?? defaultDispatch(),
    ]);

  const definitions = await (
    opts.loadAssemblyLines ?? loadBuiltinAssemblyLines
  )();
  const assemblyLine = definitions.get(opts.definitionName);
  enforceTrue(
    !!assemblyLine,
    `no assembly line defined for "${opts.definitionName}"`,
  );

  const jobRef = jobRefOf(assemblyLine);
  const runId = await jobRunsPort.start(`${jobRef}:${opts.repo}`);

  // No checkout: the detect station reads over HTTP, so an empty tmpdir satisfies
  // the executor's gitDir and the no-op gitCommit skips stage commits. The detect
  // node dispatches a station pod (createStationNodeHandler); the branch name is a
  // pure lease key + the synthetic task id for the per-attempt CR (assemblyLineId).
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-detect-"));
  const holder = os.hostname();
  const branch = detectBranchName(opts.definitionName, opts.repo);
  const stationTask = {
    taskId: opts.assemblyLineId, // synthetic — detect has no pipeline task, but the CR label needs a stable id
    assemblyLineId: opts.assemblyLineId,
    taskType: opts.definitionName,
    description: "",
    targetRepo: opts.repo,
    branch,
  };

  try {
    const result = await runSupervisor({
      taskId: null, // the lease row carries NULL — no pipeline task backs a detection run
      branchName: branch,
      gitDir: workdir,
      leaseBackend,
      assemblyLine,
      assemblyLineId: opts.assemblyLineId,
      gitCommit: async () => {},
      trace: {
        onNodeStart: (i) => assemblyLinesPort.recordNodeStart(i),
        onNodeFinish: (ref, outcome, sha) =>
          assemblyLinesPort.recordNodeFinish(ref, outcome, sha),
      },
      handlers: {
        ...builtinHandlers,
        agent: async () => {
          throw new Error("detect assembly lines have no agent nodes");
        },
        detect: createStationNodeHandler({
          launch: (node) =>
            dispatch.launch(nodeStationSpec(node, stationTask)).then(() => {}),
          poll: (assemblyLineId, nodeId) =>
            dispatch.status(nodeAgentName(assemblyLineId, nodeId)),
          heartbeat: (branchName, nodeId) =>
            leaseBackend
              .refresh(branchName, holder, undefined, nodeId)
              .then(() => {}),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }),
      },
    });

    // The detailed detector summary rides the pod's LORE_NODE_RESULT extras +
    // the stage-commit trailer; job_runs records the run's terminal reason.
    if (result.reason === "completed") {
      await jobRunsPort.complete(
        runId,
        `station run: ${opts.definitionName}:${opts.repo} completed`,
      );
    } else if (result.reason === "lease_held") {
      await jobRunsPort.complete(
        runId,
        `skipped: lease held by ${result.currentHolder ?? "unknown"}`,
      );
    } else {
      await jobRunsPort.fail(runId, result.errorMessage ?? result.reason);
    }

    return result;
  } catch (err) {
    await jobRunsPort
      .fail(runId, (err as Error).message)
      .catch((failErr: unknown) =>
        console.error(
          `[detect] job_runs fail() failed for ${runId}:`,
          (failErr as Error).message,
        ),
      );
    throw err;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

/** Production station dispatch: the agent-cr backend + a Kubernetes status reader. */
async function defaultDispatch(): Promise<DetectStationDispatch> {
  const [{ agentCrBackend }, { KubeAgentApi }] = await Promise.all([
    import("../../composition/project-boot.js"),
    import("../station/kube-agent-api.js"),
  ]);
  const backend = agentCrBackend();
  const kube = new KubeAgentApi();
  return {
    launch: (spec) => backend.launch(spec),
    status: (crName) => kube.getStatus(crName),
  };
}
