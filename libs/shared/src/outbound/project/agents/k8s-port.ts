// Kubernetes port for the agents `cluster` mode (creates a LoreTask CR); runtime injects a @kubernetes/client-node client, shared never imports it. Spec unions the three CR bodies in agent (worker/spec-task-executor/loretask-watcher) so one impl replaces all three.

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
  /** Explicit Station to run on (station nodes: def-<type> or the node's station_ref); omitted → the task type's catalog Station. */
  stationRef?: string;
  /** Extra per-run parameters merged into the CR spec (e.g. station_input). */
  parameters?: Record<string, string>;
  /** Seed values for the run's args, spread beneath the run's own keys so a seeded bag never displaces the rendered description (implementation-loop FR11). */
  lineArgs?: Record<string, unknown>;
  /** False skips per-task token/clone provisioning — API-reading station nodes need no repo and their line branch resolves no checkout. Default true. */
  clone?: boolean;
  /** The feature a planning/finalize run belongs to, threaded into the line's args so a definition can key a conversation thread on args.feature_id. */
  featureId?: string;
  /** The round's feedback-only turn, used instead of description when this run resumes a conversation the agent already holds the draft for. */
  roundFeedback?: string;
  /** The task whose run this one continues (rewind); absent means "continue the newest". */
  resumeFromTask?: string;
  /** A previous run this one continues (ai-agent-subsystem#188), resolved at dispatch from the node's `continues` declaration; absent when none or a retry. */
  conversation?: {
    source: string;
    id: string;
    pin: string;
    headersSecret: string;
  };
}

export interface K8sPort {
  createLoreTask(
    spec: LoreTaskSpec,
    opts?: { namespace?: string },
  ): Promise<{ name: string; created: boolean }>;
}
