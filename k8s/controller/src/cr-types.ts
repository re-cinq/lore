import type * as k8s from "@kubernetes/client-node";

/**
 * Minimal TypeScript shapes of the three CRDs (ADR-031). The controller is
 * standalone — it carries its own types rather than importing @re-cinq/lore-shared
 * at runtime. The CRD `openAPIV3Schema` is the source of truth; these mirror the
 * subset the controller reads.
 */

export const GROUP = "lore.re-cinq.com";
export const VERSION = "v1alpha1";
export const AGENTS_PLURAL = "agents";
export const STATIONS_PLURAL = "stations";
export const AGENTDEFS_PLURAL = "agentdefinitions";

export interface AgentResources {
  env?: { name: string; value: string }[];
  secrets?: { name: string; ref: string }[];
  mcp_servers?: Record<string, unknown>[];
  repos?: Record<string, unknown>[];
}

export interface AgentDefinitionSpec {
  description?: string;
  model?: string;
  /** Prompt TEMPLATE; may contain {placeholder} strings filled from an Agent's parameters. */
  prompt?: string;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  permission_mode?: "auto" | "bypass";
  max_turns?: number;
  resources?: AgentResources;
  output?: Record<string, unknown>;
  tool_config?: Record<string, unknown>;
}

export interface AgentDefinition {
  apiVersion?: string;
  kind?: string;
  metadata: k8s.V1ObjectMeta;
  spec: AgentDefinitionSpec;
}

export interface StationSpec {
  agentDefRef: string;
  deadlineMinutes?: number;
  successfulRunsHistoryLimit?: number;
  failedRunsHistoryLimit?: number;
  /** A standard Kubernetes PodTemplateSpec the controller stamps the run's pod from. */
  template: k8s.V1PodTemplateSpec;
}

export interface Station {
  apiVersion?: string;
  kind?: string;
  metadata: k8s.V1ObjectMeta;
  spec: StationSpec;
}

export type AgentPhase = "Pending" | "Running" | "Succeeded" | "Failed";

export interface AgentSpec {
  stationRef: string;
  taskId?: string;
  targetRepo?: string;
  branch?: string;
  /** Per-run values: passed to the agent app as arguments and used to fill the prompt template. */
  parameters?: Record<string, string>;
}

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
  spec: AgentSpec;
  status?: AgentStatus;
}
