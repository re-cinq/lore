// Catalog seed generator (ADR-031, #698): maps task-types.yaml recipes to AgentDefinition + Station CRs, one Station per task type named by type. Pure + deterministic; file IO lives in the gen-catalog CLI.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { AGENT_MAX_TURNS } from "@re-cinq/lore-shared";
import type {
  StationRecipe,
  TaskTypeRecipe,
} from "@re-cinq/lore-shared/task-types/task-types-config.js";

/** Aliased rather than restated — the field docs live with the `task-types.yaml` schema. */
export type AgentCatalogConfig = TaskTypeRecipe;
export type StationCatalogConfig = StationRecipe;

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";
const SEED_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-seed" };
// The only writable dir the agent prompts can mean by "the working directory" — unset, the base image's `/` is not writable and a run can silently exit 0 having failed to place its result (2026-08-10, laptop minikube).
const REPO_WORKDIR = "/workspace/target";

// Placeholder for the per-cluster sink URL; catalogChartYaml swaps it for the helm value.
const EVENTS_URL_SENTINEL = "__AGENT_EVENTS_URL__";

// Placeholder for the shared lore-mcp gateway URL; catalogChartYaml swaps it for the helm value (empty → block omitted).
const MCP_URL_SENTINEL = "__LORE_MCP_URL__";

// Placeholder for the /skills registry base URL; MUST be omitted (not rendered empty) when unset, or the init fetches nothing, reports success, and the container dies missing settings.json (2026-08-10, laptop minikube).
const SKILLS_SOURCE_SENTINEL = "__LORE_SKILLS_URL__";

// Placeholder for the per-cluster Lore API base URL every lore-station pod calls; catalogChartYaml swaps it for the helm value.
const API_URL_SENTINEL = "__LORE_API_URL__";
// Placeholder for the subchart namespace (umbrella spans namespaces); catalogChartYaml swaps it for the helm value.
const NAMESPACE_SENTINEL = "__NAMESPACE__";
// Placeholder for the lore-station image (per-cluster tag pin); catalogChartYaml swaps it for the helm value.
const STATION_IMAGE_SENTINEL = "__STATION_IMAGE__";
// The GKE dgraph endpoint; the seeded chart uses the helm value instead so non-GKE installs can repoint it — check-catalog-drift.sh fails loudly if the two desync.
const GKE_DGRAPH_URL =
  "http://lore-dgraph-alpha.lore-dgraph.svc.cluster.local:8080";

/** `def-<node type>`, what the Floor's nodeStationSpec resolves absent an explicit station_ref; underscores become dashes since they're invalid in RFC-1123 k8s names — the Floor's resolver applies the same transform. */
export const stationName = (name: string): string =>
  `def-${name.replaceAll("_", "-")}`;

// One key per cluster, not a list: GKE supplies ANTHROPIC_API_KEY, minikube supplies CLAUDE_CODE_OAUTH_TOKEN — the `claude` CLI reads either. Injected as a NON-optional secretKeyRef, so the key must exist in agent-secrets or the pod dies CreateContainerConfigError; only stations declaring `needs_model` get it.
export const LLM_SECRET_SENTINEL = "__LLM_SECRET_KEY__";
const AGENT_SECRETS: NonNullable<
  NonNullable<NonNullable<AgentDefinition["spec"]>["resources"]>["secrets"]
> = [{ name: LLM_SECRET_SENTINEL, ref: LLM_SECRET_SENTINEL }];

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

/** Mirrors the Floor's `GitCli` env defaults so a pod's commit and a Floor's commit share the same author. */
const GIT_IDENTITY = [
  { name: "GIT_AUTHOR_NAME", value: "Lore Agent" },
  { name: "GIT_AUTHOR_EMAIL", value: "lore-agent@re-cinq.com" },
  { name: "GIT_COMMITTER_NAME", value: "Lore Agent" },
  { name: "GIT_COMMITTER_EMAIL", value: "lore-agent@re-cinq.com" },
];

export function buildAgentDefinition(
  taskType: string,
  cfg: AgentCatalogConfig,
): AgentDefinition {
  // An empty prompt would install a silently useless AgentDefinition; every committed entry carries one, so a build that doesn't is drift worth stopping on.
  enforceTrue(
    cfg.prompt_template !== undefined,
    Error,
    `task type "${taskType}" has no prompt_template — task-types.yaml is missing a field the catalog needs`,
  );

  return {
    apiVersion: API_VERSION,
    kind: "AgentDefinition",
    metadata: { name: taskType, labels: { ...SEED_LABELS } },
    spec: {
      description: `Lore ${taskType} task recipe (seeded).`,
      ...(cfg.model ? { model: cfg.model } : {}),
      // Filled per run with CONTEXT_BOOTSTRAP — an instruction to assemble context, since nothing is fetched at dispatch.
      prompt: `${cfg.prompt_template.trimEnd()}\n\n{context}`,
      permission_mode: "bypass",
      max_turns: AGENT_MAX_TURNS,
      // Scoped, live Lore MCP via the shared HTTP gateway (server-mode=agent → no pipeline/local tools); see ADR-030.
      resources: {
        secrets: AGENT_SECRETS,
        // Every agent pod must commit with an identity — a pod has no ambient git config and would otherwise fail "Author identity unknown". Same identity the Floor's GitCli defaults to.
        env: GIT_IDENTITY,
        mcp_servers: [
          {
            name: "lore",
            transport: "http",
            url: MCP_URL_SENTINEL,
            headers_secret: "lore-mcp-auth",
          },
        ],
        // Registry-agnostic (ADR-030): fetches `<source>/<name>.tar.gz` + settings.json, empty source ⇒ inert. A recipe's own skills APPEND to lore-context rather than replace it, so it can't lose the skill that makes `lore_assemble_context` automatic.
        skills: [
          "lore-context",
          ...(cfg.skills ?? []).filter((name) => name !== "lore-context"),
        ],
        skills_source: SKILLS_SOURCE_SENTINEL,
      },
      // Defense-in-depth — an agent must never spawn more pipeline work from inside a run; recipe-declared denies (e.g. #1160) append after.
      disallowed_tools: [
        "mcp__lore__lore_create_pipeline_task",
        ...(cfg.disallowed_tools ?? []),
      ],
      // D8 (#687): stream NDJSON run output to the Floor's /api/agent-events sink for cost accounting.
      output: {
        sinks: [
          { type: "stdout" },
          {
            type: "http",
            url: EVENTS_URL_SENTINEL,
            headers_secret: "agent-events-auth",
          },
        ],
        // A file deliverable is raised as a `kind:"file"` event on the sink above once the agent exits — the only way the artifact leaves the pod (ai-agent-subsystem#188).
        ...(cfg.watch ? { watch: [cfg.watch] } : {}),
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
              ...(cfg.repo_workdir === false
                ? {}
                : { workingDir: REPO_WORKDIR }),
              // Explicit: Autopilot caps an undeclared pod at 1Gi and a large-diff review run gets EVICTED mid-run after billing (#1287/#1288, same class as #1160).
              resources: {
                requests: {
                  cpu: "250m",
                  memory: "512Mi",
                  "ephemeral-storage": "2Gi",
                },
                limits: {
                  cpu: "1",
                  memory: "1Gi",
                  "ephemeral-storage": "4Gi",
                },
              },
            },
          ],
        },
      },
    },
  };
}

/** An exec-vendor recipe for one builtin station: the prompt template is exactly the station_input parameter, so the pod's argv ends with the node's JSON. */
export function buildStationDefinition(
  name: string,
  cfg: StationCatalogConfig,
): AgentDefinition {
  // `tool_config` is typed `unknown`, so `{ command: undefined }` compiles and seeds a recipe with nothing to run; every committed entry carries `command`, so a build that doesn't is drift worth stopping on.
  enforceTrue(
    cfg.command !== undefined,
    Error,
    `station "${name}" has no command — task-types.yaml is missing a field the catalog needs`,
  );

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
      // A Station pod-template env block is OVERWRITTEN by the controller and silently lost (learned live, 2026-07-17), so the API base URL + ingest token ship via resources.env on every recipe; per-station cfg.env appends after.
      resources: {
        env: [
          { name: "LORE_API_URL", value: API_URL_SENTINEL },
          ...Object.entries(cfg.env ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        ],
        // A model credential only where the station actually calls a model — a deterministic station omitting it fails invisibly otherwise.
        secrets: [
          { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
          ...(cfg.needs_model ? AGENT_SECRETS : []),
        ],
      },
    },
  };
}

/** The lore-station image (helm-pinned tag) with a short deadline — stations are deterministic, not hour-long LLM runs. */
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
        // Template labels survive the per-task Station clone AND the controller's label merge — the only marker a NetworkPolicy can key on that still matches pt-* pods.
        ...(cfg.pod_labels && Object.keys(cfg.pod_labels).length > 0
          ? { metadata: { labels: { ...cfg.pod_labels } } }
          : {}),
        spec: {
          containers: [
            {
              name: "agent",
              image: STATION_IMAGE_SENTINEL,
              // Same explicit ephemeral-storage as the agent template: ingest/validate stations clone the repo too, and Autopilot's 1Gi undeclared default is the eviction line.
              resources: {
                requests: {
                  cpu: "250m",
                  memory: "512Mi",
                  "ephemeral-storage": "2Gi",
                },
                limits: {
                  cpu: "1",
                  memory: "1Gi",
                  "ephemeral-storage": "4Gi",
                },
              },
            },
          ],
        },
      },
    },
  };
}

/** One AgentDefinition + Station per task type, then per builtin station, in declaration order. */
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

/** The ai-agents-helm `files/catalog-seed.yaml` body, applied SERVER-SIDE by the `catalog-seed` pre-upgrade hook rather than as a template — Helm diffs rendered manifests and never reads live state, so a pruned object (#1301) stays pruned through later no-op deploys (#1468). */
export function catalogChartYaml(
  taskTypes: Record<string, AgentCatalogConfig>,
  stationTypes: Record<string, StationCatalogConfig> = {},
): string {
  const header =
    "# Code generated from scripts/task-types.yaml by gen-catalog. DO NOT EDIT.\n" +
    "# Seeded catalog (ADR-031, re-cinq/lore#698). Lives at files/catalog-seed.yaml and is\n" +
    "# applied server-side by the catalog-seed pre-upgrade hook (templates/catalog-seed-job.yaml),\n" +
    "# which runs AFTER the CRD hook so a lagging schema cannot prune these fields (#1468).\n" +
    "# .Values.seedCatalog gates the hook, not this file.\n";
  const docs = buildCatalog(taskTypes, stationTypes).map((cr) =>
    stringify(
      {
        ...cr,
        metadata: {
          ...cr.metadata,
          namespace: NAMESPACE_SENTINEL,
          annotations: { "helm.sh/resource-policy": "keep" },
        },
      },
      // Literal (`|`), never folded (`>-`): folding would rewrap a prompt's indented JSON/code blocks, silently changing the recipe the pod runs.
      { blockQuote: "literal" },
    ),
  );
  const body = `${header}---\n${docs.join("---\n")}`;

  // Guard the mcp_servers block behind .Values.loreMcpUrl: unset (default, pre-gateway clusters), the block is omitted so no CRD carries an empty-`url` MCP entry.
  const guarded = body.replace(
    /^( *)mcp_servers:\n((?:\1 .*\n)*)/gm,
    (_m, indent: string, entries: string) =>
      `{{- if .Values.loreMcpUrl }}\n${indent}mcp_servers:\n${entries}{{- end }}\n`,
  );

  // Same guard for skills: `skills: [...]` beside `skills_source: null` is not inert — the init fetches nothing, reports SUCCESS, and the container dies on the missing settings.json.
  const skillsGuarded = guarded.replace(
    /^( *)skills:\n((?:\1 .*\n)*)\1skills_source: (.*)\n/gm,
    (_m, indent: string, entries: string, source: string) =>
      `{{- if .Values.loreSkillsUrl }}\n${indent}skills:\n${entries}${indent}skills_source: ${source}\n{{- end }}\n`,
  );

  // Guard the http telemetry sink behind .Values.agentEventsUrl: a satellite cluster has no bus-wide credential for it (ADR-024/FR5) and leaves the URL unset, so an unguarded sink is a hard CreateContainerConfigError on every satellite pod (found live, 2026-08-26).
  const sinksGuarded = skillsGuarded.replace(
    /^( *)- type: http\n\1 {2}url: .*\n\1 {2}headers_secret: agent-events-auth\n/gm,
    (match) => `{{- if .Values.agentEventsUrl }}\n${match}{{- end }}\n`,
  );

  // {context} fills with an instruction to call lore_assemble_context, only true where the pod has a Lore MCP; guarded on the same value as the mcp_servers block so the two cannot drift apart (#1629).
  const contextGuarded = sinksGuarded.replace(
    /^( *)\{context\}\n/gm,
    (_m, indent: string) =>
      `{{- if .Values.loreMcpUrl }}\n${indent}{context}\n{{- end }}\n`,
  );

  return contextGuarded
    .replaceAll(LLM_SECRET_SENTINEL, "{{ .Values.agentLlmSecretKey }}")
    .replaceAll(EVENTS_URL_SENTINEL, "{{ .Values.agentEventsUrl }}")
    .replaceAll(MCP_URL_SENTINEL, "{{ .Values.loreMcpUrl }}")
    .replaceAll(SKILLS_SOURCE_SENTINEL, "{{ .Values.loreSkillsUrl }}")
    .replaceAll(API_URL_SENTINEL, "{{ .Values.loreApiUrl }}")
    .replaceAll(GKE_DGRAPH_URL, "{{ .Values.dgraphUrl }}")
    .replaceAll(NAMESPACE_SENTINEL, "{{ .Values.namespace }}")
    .replaceAll(STATION_IMAGE_SENTINEL, "{{ .Values.stationImage }}");
}
