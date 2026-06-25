// Catalog seed generator (ADR-031, #698 seed strand): maps the resolved task-type
// recipes (scripts/task-types.yaml) to the `AgentDefinition` + `Station` CRs the
// ai-agent-subsystem needs — one Station per task type, named by task type, so the
// AgentBackend's `stationRef = <taskType>` resolves. Pure + deterministic; the file
// IO (read task-types.yaml, write the chart) is in the gen-catalog CLI.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";

export interface TaskTypeConfig {
  prompt_template: string;
  model?: string;
  timeout_minutes?: number;
}

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";
const SEED_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-seed" };

export function buildAgentDefinition(taskType: string, cfg: TaskTypeConfig): AgentDefinition {
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
    },
  };
}

export function buildStation(taskType: string, cfg: TaskTypeConfig): Station {
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
  taskTypes: Record<string, TaskTypeConfig>,
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
export function catalogChartYaml(taskTypes: Record<string, TaskTypeConfig>): string {
  const header =
    "# Code generated from scripts/task-types.yaml by gen-catalog. DO NOT EDIT.\n" +
    "# Seeded catalog (ADR-031, re-cinq/lore#698). Guarded by .Values.seedCatalog so\n" +
    "# operators stop re-seeding after first install; the web UI owns these thereafter.\n";
  const docs = buildCatalog(taskTypes).map((cr) =>
    stringify({
      ...cr,
      metadata: { ...cr.metadata, annotations: { "helm.sh/resource-policy": "keep" } },
    }),
  );
  return `${header}{{- if .Values.seedCatalog }}\n---\n${docs.join("---\n")}{{- end }}\n`;
}
