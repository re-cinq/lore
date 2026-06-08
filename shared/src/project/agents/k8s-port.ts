/**
 * Kubernetes port for the agents `cluster` mode — creates a LoreTask CR. The
 * runtime injects a client wrapping @kubernetes/client-node; shared never
 * imports it. The spec mirrors the CR body built in agent/src/worker.ts.
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
}

export interface K8sPort {
  createLoreTask(spec: LoreTaskSpec, opts?: { namespace?: string }): Promise<{ name: string; created: boolean }>;
}
