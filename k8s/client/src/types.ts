import type * as k8s from "@kubernetes/client-node";

/** CRD coordinates (ADR-031). Kept local so this client has no dependency on the controller package. */
export const GROUP = "lore.re-cinq.com";
export const VERSION = "v1alpha1";
export const AGENTS_PLURAL = "agents";
export const DEFAULT_NAMESPACE = "lore-agents";

export type AgentPhase = "Pending" | "Running" | "Succeeded" | "Failed";

export interface AgentStatus {
  phase?: AgentPhase;
  jobName?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  output?: string;
  prUrl?: string;
  failureReason?: string;
}

export interface Agent {
  apiVersion?: string;
  kind?: string;
  metadata: k8s.V1ObjectMeta;
  spec: {
    stationRef: string;
    taskId?: string;
    targetRepo?: string;
    branch?: string;
    parameters?: Record<string, string>;
  };
  status?: AgentStatus;
}
