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
}

export interface K8sPort {
  createLoreTask(spec: LoreTaskSpec, opts?: { namespace?: string }): Promise<{ name: string; created: boolean }>;
}
