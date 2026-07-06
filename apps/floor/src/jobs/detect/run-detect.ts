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
  createDetectHandler,
  loadBuiltinAssemblyLines,
  runSupervisor,
  type AssemblyLine,
  type DetectorFn,
  type SupervisorResult,
} from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { JobRunsPort } from "@re-cinq/lore-shared/project/job-runs/job-runs-port.js";
import type { LeaseBackend } from "@re-cinq/lore-shared/project/leases/lease-backends.js";

export interface RunDetectOptions {
  /** The pipeline.assembly_lines row minted by assemblyLines().start(). */
  assemblyLineId: string;
  definitionName: string;
  repo: string;
  /** Overrides for tests; production defaults resolve lazily in runDetect. */
  detectors?: Record<string, DetectorFn>;
  loadAssemblyLines?: () => Promise<Map<string, AssemblyLine>>;
  assemblyLinesPort?: AssemblyLinesPort;
  jobRunsPort?: JobRunsPort;
  leaseBackend?: LeaseBackend;
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

export async function runDetect(opts: RunDetectOptions): Promise<SupervisorResult> {
  const [detectorRegistry, assemblyLinesPort, jobRunsPort, leaseBackend] = await Promise.all([
    opts.detectors ?? import("./detectors.js").then((m) => m.detectors),
    opts.assemblyLinesPort ?? import("../../kernel/queues.js").then((m) => m.assemblyLines()),
    opts.jobRunsPort ?? import("../../kernel/queues.js").then((m) => m.jobRuns()),
    opts.leaseBackend ??
      import("../../main-loop/lease/lease-backend.js").then((m) => m.leaseBackendForEnv()),
  ]);

  const definitions = await (opts.loadAssemblyLines ?? loadBuiltinAssemblyLines)();
  const assemblyLine = definitions.get(opts.definitionName);
  enforceTrue(!!assemblyLine, `no assembly line defined for "${opts.definitionName}"`);

  const jobRef = jobRefOf(assemblyLine);
  const runId = await jobRunsPort.start(`${jobRef}:${opts.repo}`);

  // No checkout: an empty tmpdir satisfies the executor's gitDir, the no-op
  // gitCommit skips stage commits, and resume-from-branch reads null (fresh run).
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-detect-"));
  let summary = "";

  try {
    const result = await runSupervisor({
      // No pipeline task backs a detection run — the lease row carries NULL.
      taskId: null,
      branchName: detectBranchName(opts.definitionName, opts.repo),
      gitDir: workdir,
      leaseBackend,
      assemblyLine,
      assemblyLineId: opts.assemblyLineId,
      gitCommit: async () => {},
      trace: {
        onNodeStart: (i) => assemblyLinesPort.recordNodeStart(i),
        onNodeFinish: (ref, outcome, sha) => assemblyLinesPort.recordNodeFinish(ref, outcome, sha),
      },
      handlers: {
        ...builtinHandlers,
        agent: async () => {
          throw new Error("detect assembly lines have no agent nodes");
        },
        detect: createDetectHandler(detectorRegistry, {
          repo: opts.repo,
          onSummary: (s) => void (summary = s),
        }),
      },
    });

    if (result.reason === "completed") {
      await jobRunsPort.complete(runId, summary);
    }

    if (result.reason === "lease_held") {
      await jobRunsPort.complete(
        runId,
        `skipped: lease held by ${result.currentHolder ?? "unknown"}`,
      );
    }

    if(result.reason !== "completed" && result.reason !== "lease_held") {
      await jobRunsPort.fail(runId, result.errorMessage ?? result.reason);
    }

    return result;
  } catch (err) {
    await jobRunsPort
      .fail(runId, (err as Error).message)
      .catch((failErr) =>
        console.error(`[detect] job_runs fail() failed for ${runId}:`, (failErr as Error).message),
      );
    throw err;
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}
