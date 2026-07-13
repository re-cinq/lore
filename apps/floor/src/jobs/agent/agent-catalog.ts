// Catalog seed generator (ADR-031, #698 seed strand): maps the resolved task-type
// recipes (scripts/task-types.yaml) to the `AgentDefinition` + `Station` CRs the
// ai-agent-subsystem needs — one Station per task type, named by task type, so the
// AgentCrBackend's `stationRef = <taskType>` resolves. Pure + deterministic; the file
// IO (read task-types.yaml, write the chart) is in the gen-catalog CLI.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";

export interface AgentCatalogConfig {
  prompt_template: string;
  model?: string;
  timeout_minutes?: number;
}

/** A builtin station recipe (non-LLM node run by the exec vendor). */
export interface StationCatalogConfig {
  /** The argv the exec vendor spawns; the rendered station_input is appended. */
  command: string[];
  timeout_minutes?: number;
}

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";
const SEED_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-seed" };
// Placeholder for the per-cluster sink URL; catalogChartYaml swaps it for the helm value.
const EVENTS_URL_SENTINEL = "__AGENT_EVENTS_URL__";
// Placeholder for the subchart namespace (umbrella spans namespaces, so each CR needs
// an explicit namespace); catalogChartYaml swaps it for the helm value.
const NAMESPACE_SENTINEL = "__NAMESPACE__";
// Placeholder for the lore-station image (per-cluster tag pin); catalogChartYaml
// swaps it for the helm value.
const STATION_IMAGE_SENTINEL = "__STATION_IMAGE__";

/** Station Station/AgentDefinition names: `def-<node type>` — what the Floor's
 *  nodeStationSpec resolves when a node has no explicit station_ref. Underscores in
 *  a node type (e.g. `github_action`) are not valid in an RFC-1123 k8s resource name,
 *  so they become dashes; the Floor's resolver applies the same transform. */
export const stationName = (name: string): string => `def-${name.replaceAll("_", "-")}`;

const OUTPUT_SINKS: NonNullable<NonNullable<AgentDefinition["spec"]>["output"]> = {
  sinks: [
    { type: "stdout" },
    { type: "http", url: EVENTS_URL_SENTINEL, headers_secret: "agent-events-auth" },
  ],
};

export function buildAgentDefinition(taskType: string, cfg: AgentCatalogConfig): AgentDefinition {
  return {
    apiVersion: API_VERSION,
    kind: "AgentDefinition",
    metadata: { name: taskType, labels: { ...SEED_LABELS } },
    spec: {
      description: `Lore ${taskType} task recipe (seeded).`,
      ...(cfg.model ? { model: cfg.model } : {}),
      // The {context} placeholder is filled by the Floor's context hydration (D5).
      prompt: `${cfg.prompt_template.trimEnd()}\n\n{context}`,
      permission_mode: "bypass",
      max_turns: 40,
      // D8 (#687): stream NDJSON run output to the Floor's /api/agent-events sink for
      // cost accounting. URL is per-cluster (.Values.agentEventsUrl); headers_secret
      // carries the Authorization header from agent-secrets.
      output: {
        sinks: [
          { type: "stdout" },
          { type: "http", url: EVENTS_URL_SENTINEL, headers_secret: "agent-events-auth" },
        ],
      },
    },
  };
}

export function buildStation(taskType: string, cfg: AgentCatalogConfig): Station {
  return {
    apiVersion: API_VERSION,
    kind: "Station",
    metadata: { name: taskType, labels: { ...SEED_LABELS } },
    spec: {
      agentDefRef: taskType,
      deadlineMinutes: cfg.timeout_minutes ?? 30,
      template: {
        spec: {
          containers: [
            {
              name: "agent",
              image: BASE_IMAGE,
              resources: {
                requests: { cpu: "250m", memory: "512Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
            },
          ],
        },
      },
    },
  };
}

/** An exec-vendor recipe for one builtin station: the prompt template is exactly
 *  the station_input parameter, so the pod's argv ends with the node's JSON. */
export function buildStationDefinition(name: string, cfg: StationCatalogConfig): AgentDefinition {
  return {
    apiVersion: API_VERSION,
    kind: "AgentDefinition",
    metadata: { name: stationName(name), labels: { ...SEED_LABELS } },
    spec: {
      description: `Lore ${name} station recipe (seeded).`,
      model: "exec",
      prompt: "{station_input}",
      permission_mode: "bypass",
      max_turns: 1,
      tool_config: { command: cfg.command },
      output: OUTPUT_SINKS,
    },
  };
}

/** The Station a builtin station node runs on: the lore-station image (helm-pinned
 *  tag) with a short deadline — stations are deterministic, not hour-long LLM runs. */
export function buildStationStation(name: string, cfg: StationCatalogConfig): Station {
  return {
    apiVersion: API_VERSION,
    kind: "Station",
    metadata: { name: stationName(name), labels: { ...SEED_LABELS } },
    spec: {
      agentDefRef: stationName(name),
      deadlineMinutes: cfg.timeout_minutes ?? 15,
      template: {
        spec: {
          containers: [
            {
              name: "agent",
              image: STATION_IMAGE_SENTINEL,
              resources: {
                requests: { cpu: "250m", memory: "512Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
            },
          ],
        },
      },
    },
  };
}

/** One AgentDefinition + Station per task type, then per builtin station, in
 *  declaration order. */
export function buildCatalog(
  taskTypes: Record<string, AgentCatalogConfig>,
  stationTypes: Record<string, StationCatalogConfig> = {},
): Array<AgentDefinition | Station> {
  const out: Array<AgentDefinition | Station> = [];
  for (const [taskType, cfg] of Object.entries(taskTypes)) {
    out.push(buildAgentDefinition(taskType, cfg), buildStation(taskType, cfg));
  }
  for (const [name, cfg] of Object.entries(stationTypes)) {
    out.push(buildStationDefinition(name, cfg), buildStationStation(name, cfg));
  }
  return out;
}

/** The ai-agents-helm `templates/catalog.yaml` body: the seeded CRs guarded by
 *  `.Values.seedCatalog` (operators set it false after first install so they stop
 *  re-seeding — the web UI owns the recipes thereafter) and each annotated to
 *  survive uninstall. */
export function catalogChartYaml(
  taskTypes: Record<string, AgentCatalogConfig>,
  stationTypes: Record<string, StationCatalogConfig> = {},
): string {
  const header =
    "# Code generated from scripts/task-types.yaml by gen-catalog. DO NOT EDIT.\n" +
    "# Seeded catalog (ADR-031, re-cinq/lore#698). Guarded by .Values.seedCatalog so\n" +
    "# operators stop re-seeding after first install; the web UI owns these thereafter.\n";
  const docs = buildCatalog(taskTypes, stationTypes).map((cr) =>
    stringify({
      ...cr,
      metadata: {
        ...cr.metadata,
        namespace: NAMESPACE_SENTINEL,
        annotations: { "helm.sh/resource-policy": "keep" },
      },
    }),
  );
  const body = `${header}{{- if .Values.seedCatalog }}\n---\n${docs.join("---\n")}{{- end }}\n`;
  return body
    .replaceAll(EVENTS_URL_SENTINEL, "{{ .Values.agentEventsUrl }}")
    .replaceAll(NAMESPACE_SENTINEL, "{{ .Values.namespace }}")
    .replaceAll(STATION_IMAGE_SENTINEL, "{{ .Values.stationImage }}");
}
