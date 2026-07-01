// Catalog seed generator (ADR-031, #698 seed strand): maps the resolved task-type
// recipes (scripts/task-types.yaml) to the `AgentDefinition` + `Station` CRs the
// ai-agent-subsystem needs — one Station per task type, named by task type, so the
// AgentBackend's `stationRef = <taskType>` resolves. Pure + deterministic; the file
// IO (read task-types.yaml, write the chart) is in the gen-catalog CLI.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";

export interface AgentCatalogConfig {
  prompt_template: string;
  model?: string;
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

/** One AgentDefinition + Station per task type, in declaration order. */
export function buildCatalog(
  taskTypes: Record<string, AgentCatalogConfig>,
): Array<AgentDefinition | Station> {
  const out: Array<AgentDefinition | Station> = [];
  for (const [taskType, cfg] of Object.entries(taskTypes)) {
    out.push(buildAgentDefinition(taskType, cfg), buildStation(taskType, cfg));
  }
  return out;
}

/** The ai-agents-helm `templates/catalog.yaml` body: the seeded CRs guarded by
 *  `.Values.seedCatalog` (operators set it false after first install so they stop
 *  re-seeding — the web UI owns the recipes thereafter) and each annotated to
 *  survive uninstall. */
export function catalogChartYaml(taskTypes: Record<string, AgentCatalogConfig>): string {
  const header =
    "# Code generated from scripts/task-types.yaml by gen-catalog. DO NOT EDIT.\n" +
    "# Seeded catalog (ADR-031, re-cinq/lore#698). Guarded by .Values.seedCatalog so\n" +
    "# operators stop re-seeding after first install; the web UI owns these thereafter.\n";
  const docs = buildCatalog(taskTypes).map((cr) =>
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
    .replaceAll(NAMESPACE_SENTINEL, "{{ .Values.namespace }}");
}
