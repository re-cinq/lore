/**
 * Kubernetes port for the agents `cluster` mode — creates a LoreTask CR. The
 * runtime injects a client wrapping @kubernetes/client-node; shared never
 * imports it. The spec is the union of the three CR bodies in agent
 * (worker.ts / spec-task-executor.ts / loretask-watcher.ts) so one impl
 * replaces all three: base task-id/task-type labels are always set; extraLabels
 * merge in (dark-factory, spec-slug); prNumber + darkFactory are optional.
 */

export interface LoreTaskSpec {
  taskId: string;
  taskType: string;
  description: string;
  prompt: string;
  targetRepo: string;
  branch: string;
  model?: string;
  timeoutMinutes?: number;
  prNumber?: number;
  name?: string;
  extraLabels?: Record<string, string>;
  darkFactory?: { workflowName: string; baseBranch: string };
  /** BYO execution container (ADR-025); omitted → CR/controller default. */
  image?: string;
  /** Explicit Station to run on (station nodes: `def-<type>` or the node's
   *  station_ref); omitted → the task type's catalog Station. */
  stationRef?: string;
  /** Extra per-run parameters merged into the CR spec (e.g. `station_input`). */
  parameters?: Record<string, string>;
  /** false skips context hydration (D5) — station recipes render only
   *  {station_input}, so injected context is dead weight on the CR (and an
   *  empty-description dispatch assembles an unbounded-query blob that blew
   *  the 2 MiB apiserver limit, 2026-07-17). Default true. */
  hydrate?: boolean;
  /** false skips per-task token/clone provisioning: API-reading station nodes
   *  (detect/gate/retrospective/triage) need no repo, and their line branch is
   *  a synthetic lease key no `git checkout` could resolve. Default true. */
  clone?: boolean;
}

export interface K8sPort {
  createLoreTask(
    spec: LoreTaskSpec,
    opts?: { namespace?: string },
  ): Promise<{ name: string; created: boolean }>;
}
