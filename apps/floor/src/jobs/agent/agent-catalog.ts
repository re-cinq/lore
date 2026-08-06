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
  /** Plain env for the station pod (e.g. def-ingest's LORE_DGRAPH_HTTP — the
   *  label-scoped dgraph egress exists only for that station type, FR4). */
  env?: Record<string, string>;
  /** Pod-template labels (e.g. the dgraph-egress marker a NetworkPolicy selects).
   *  MUST ride the template, not the Station name: the per-task triple renames
   *  the Station to pt-<id>, so a name-keyed selector loses its pods, while the
   *  controller's label merge preserves template labels (learned live: every
   *  round-3 ingest pod hung to its deadline with dgraph egress silently gone). */
  pod_labels?: Record<string, string>;
}

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";
const SEED_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-seed" };
// Placeholder for the per-cluster sink URL; catalogChartYaml swaps it for the helm value.
const EVENTS_URL_SENTINEL = "__AGENT_EVENTS_URL__";

// Placeholder for the shared lore-mcp gateway URL agent recipes point at;
// catalogChartYaml swaps it for the helm value (empty → the block is omitted).
const MCP_URL_SENTINEL = "__LORE_MCP_URL__";

// Placeholder for the per-cluster Lore API base URL every lore-station pod calls
// (createStationProject / apiEmbed / payload fetch); catalogChartYaml swaps it for
// the helm value.
const API_URL_SENTINEL = "__LORE_API_URL__";
// Placeholder for the subchart namespace (umbrella spans namespaces, so each CR needs
// an explicit namespace); catalogChartYaml swaps it for the helm value.
const NAMESPACE_SENTINEL = "__NAMESPACE__";
// Placeholder for the lore-station image (per-cluster tag pin); catalogChartYaml
// swaps it for the helm value.
const STATION_IMAGE_SENTINEL = "__STATION_IMAGE__";
// The GKE dgraph endpoint the ingest recipe's LORE_DGRAPH_HTTP carries verbatim in
// scripts/task-types.yaml (kept literal there for the runtime YAML fallback); the
// seeded chart references the helm value instead so a non-GKE install (minikube) can
// repoint it. check-catalog-drift.sh fails loudly if the two ever desync.
const GKE_DGRAPH_URL =
  "http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080";

/** Station Station/AgentDefinition names: `def-<node type>` — what the Floor's
 *  nodeStationSpec resolves when a node has no explicit station_ref. Underscores in
 *  a node type (e.g. `github_action`) are not valid in an RFC-1123 k8s resource name,
 *  so they become dashes; the Floor's resolver applies the same transform. */
export const stationName = (name: string): string =>
  `def-${name.replaceAll("_", "-")}`;

// The agent CLI authenticates to Anthropic with ANTHROPIC_API_KEY. The controller only
// injects keys a recipe declares here (from the agent-secrets Secret), so without it a run
// pod has no key and the agent cannot call the model. Stations (exec vendor) omit it.
const AGENT_SECRETS: NonNullable<
  NonNullable<NonNullable<AgentDefinition["spec"]>["resources"]>["secrets"]
> = [{ name: "ANTHROPIC_API_KEY", ref: "ANTHROPIC_API_KEY" }];

const OUTPUT_SINKS: NonNullable<
  NonNullable<AgentDefinition["spec"]>["output"]
> = {
  sinks: [
    { type: "stdout" },
    {
      type: "http",
      url: EVENTS_URL_SENTINEL,
      headers_secret: "agent-events-auth",
    },
  ],
};

export function buildAgentDefinition(
  taskType: string,
  cfg: AgentCatalogConfig,
): AgentDefinition {
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
      // Agent nodes get a scoped, live Lore MCP via the shared HTTP gateway
      // (server-mode=agent → no pipeline/local tools). headers_secret carries the
      // Bearer from agent-secrets, exactly like the agent-events sink below.
      // See ADR-030 (the AgentTool seam) + specs/mcp-self-update siblings.
      resources: {
        secrets: AGENT_SECRETS,
        mcp_servers: [
          {
            name: "lore",
            transport: "http",
            url: MCP_URL_SENTINEL,
            headers_secret: "lore-mcp-auth",
          },
        ],
      },
      // Defense-in-depth (the gateway already omits it in agent mode): an agent
      // must never spawn more pipeline work from inside a run.
      disallowed_tools: ["mcp__lore__lore_create_pipeline_task"],
      // D8 (#687): stream NDJSON run output to the Floor's /api/agent-events sink for
      // cost accounting. URL is per-cluster (.Values.agentEventsUrl); headers_secret
      // carries the Authorization header from agent-secrets.
      output: {
        sinks: [
          { type: "stdout" },
          {
            type: "http",
            url: EVENTS_URL_SENTINEL,
            headers_secret: "agent-events-auth",
          },
        ],
      },
    },
  };
}

export function buildStation(
  taskType: string,
  cfg: AgentCatalogConfig,
): Station {
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
export function buildStationDefinition(
  name: string,
  cfg: StationCatalogConfig,
): AgentDefinition {
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
      // The controller folds recipe resources.env into the run env; a Station
      // pod-template env block is OVERWRITTEN by the controller (jobspec.d
      // wirePodTemplate) and silently lost — learned live, 2026-07-17. Every
      // station pod reads/writes over HTTP (createStationProject, D7), so the
      // API base URL + ingest token ship on every recipe; per-station cfg.env
      // (e.g. def-ingest's LORE_DGRAPH_HTTP) appends after.
      resources: {
        env: [
          { name: "LORE_API_URL", value: API_URL_SENTINEL },
          ...Object.entries(cfg.env ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        ],
        secrets: [{ name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" }],
      },
    },
  };
}

/** The Station a builtin station node runs on: the lore-station image (helm-pinned
 *  tag) with a short deadline — stations are deterministic, not hour-long LLM runs. */
export function buildStationStation(
  name: string,
  cfg: StationCatalogConfig,
): Station {
  return {
    apiVersion: API_VERSION,
    kind: "Station",
    metadata: { name: stationName(name), labels: { ...SEED_LABELS } },
    spec: {
      agentDefRef: stationName(name),
      deadlineMinutes: cfg.timeout_minutes ?? 15,
      template: {
        // Template labels survive the per-task Station clone AND the
        // controller's label merge — the only marker a NetworkPolicy can key
        // on that still matches pt-* pods (a station-name selector does not).
        ...(cfg.pod_labels && Object.keys(cfg.pod_labels).length > 0
          ? { metadata: { labels: { ...cfg.pod_labels } } }
          : {}),
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
    .replaceAll(MCP_URL_SENTINEL, "{{ .Values.loreMcpUrl }}")
    .replaceAll(API_URL_SENTINEL, "{{ .Values.loreApiUrl }}")
    .replaceAll(GKE_DGRAPH_URL, "{{ .Values.dgraphUrl }}")
    .replaceAll(NAMESPACE_SENTINEL, "{{ .Values.namespace }}")
    .replaceAll(STATION_IMAGE_SENTINEL, "{{ .Values.stationImage }}");
}
