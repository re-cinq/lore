// Catalog seed generator (ADR-031, #698 seed strand): maps the resolved task-type
// recipes (scripts/task-types.yaml) to the `AgentDefinition` + `Station` CRs the
// ai-agent-subsystem needs — one Station per task type, named by task type, so the
// AgentCrBackend's `stationRef = <taskType>` resolves. Pure + deterministic; the file
// IO (read task-types.yaml, write the chart) is in the gen-catalog CLI.

import type { AgentDefinition, Station } from "@re-cinq/agent-contracts";
import { stringify } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { AGENT_MAX_TURNS } from "@re-cinq/lore-shared";
import type {
  StationRecipe,
  TaskTypeRecipe,
} from "@re-cinq/lore-shared/task-types/task-types-config.js";

/** The task-type and station recipes, as `scripts/task-types.yaml` declares them.
 *  Aliased rather than restated — the field docs live with the schema now. */
export type AgentCatalogConfig = TaskTypeRecipe;
export type StationCatalogConfig = StationRecipe;

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";
const SEED_LABELS = { "app.kubernetes.io/managed-by": "lore-catalog-seed" };
// Where the init clones the target repo ($WORKSPACE_DIR/<repo name>), and therefore
// the only writable directory the agent prompts can mean by "the working directory".
// Left unset, the container inherits the base image's `/`, which is NOT writable: a
// feature-planning agent produced a complete result.json, failed to place it
// (`cp: cannot create regular file '/result.json': Permission denied`), wrote it to
// $HOME instead, and exited 0 — so the run "succeeded" while the round it was for
// failed with no result posted (2026-08-10, laptop minikube).
const REPO_WORKDIR = "/workspace/target";

// Placeholder for the per-cluster sink URL; catalogChartYaml swaps it for the helm value.
const EVENTS_URL_SENTINEL = "__AGENT_EVENTS_URL__";

// Placeholder for the shared lore-mcp gateway URL agent recipes point at;
// catalogChartYaml swaps it for the helm value (empty → the block is omitted).
const MCP_URL_SENTINEL = "__LORE_MCP_URL__";

// Placeholder for the gateway's /skills registry base URL; catalogChartYaml swaps it
// for the helm value and omits the whole skills block when that value is empty.
// The block MUST be omitted rather than rendered with an empty source: a recipe
// declaring `skills` with `skills_source: null` is not inert. The init runs its
// skills step, fetches nothing, reports success, and the agent container then dies
// with `Settings file not found: $HOME/.claude/settings.json` — the file that step
// fetches from `<source>/settings.json` (2026-08-10, laptop minikube).
const SKILLS_SOURCE_SENTINEL = "__LORE_SKILLS_URL__";

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

// Placeholder for the agent's LLM credential. The controller only injects keys a recipe
// declares here (from the agent-secrets Secret) and renders each as a NON-optional
// secretKeyRef — so the declared key must exist in that Secret or every run pod dies
// CreateContainerConfigError. That is why this is one key per cluster rather than a
// list: GKE supplies ANTHROPIC_API_KEY (the values.yaml default), a laptop minikube
// supplies CLAUDE_CODE_OAUTH_TOKEN instead. The `claude` CLI reads either from its
// environment, so the vendor never has to know which one it got. catalogChartYaml swaps
// the sentinel for the helm value. A station gets it only when its recipe says
// `needs_model` — most are deterministic and a key they never use is surface for
// nothing.
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

export function buildAgentDefinition(
  taskType: string,
  cfg: AgentCatalogConfig,
): AgentDefinition {
  // A recipe with no prompt cannot be seeded, and an empty one would install a
  // silently useless AgentDefinition. The committed file carries this on every
  // entry; a build that does not is drift worth stopping on.
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
      // The {context} placeholder is filled per run with CONTEXT_BOOTSTRAP — an
      // instruction to assemble context, since nothing is fetched at dispatch.
      prompt: `${cfg.prompt_template.trimEnd()}\n\n{context}`,
      permission_mode: "bypass",
      max_turns: AGENT_MAX_TURNS,
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
        // Agent skills fetched by the init from the gateway's /skills registry. The
        // subsystem is registry-agnostic (ADR-030): it fetches `<source>/<name>.tar.gz`
        // + `<source>/settings.json`. Empty source ⇒ no fetch, so inert until deployed.
        skills: ["lore-context"],
        skills_source: SKILLS_SOURCE_SENTINEL,
      },
      // Defense-in-depth (the gateway already omits it in agent mode): an agent
      // must never spawn more pipeline work from inside a run. Recipe-declared
      // denies (e.g. the review family's package-install ban, #1160) append after.
      disallowed_tools: [
        "mcp__lore__lore_create_pipeline_task",
        ...(cfg.disallowed_tools ?? []),
      ],
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
        // A recipe whose deliverable is a file declares it here: the subsystem
        // raises it as a named `kind:"file"` event on the sink above once the
        // agent exits, which is the only way the artifact leaves the pod
        // (ai-agent-subsystem#188).
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
              // ephemeral-storage is EXPLICIT: Autopilot caps an undeclared pod
              // at 1Gi, and a large-diff review run (clone + claude session
              // temp) blows through that and gets EVICTED mid-run after the
              // model has already billed — 2026-08-18, PRs #1287/#1288, the
              // same class as the 2026-08-13 review-pod evictions (#1160).
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

/** An exec-vendor recipe for one builtin station: the prompt template is exactly
 *  the station_input parameter, so the pod's argv ends with the node's JSON. */
export function buildStationDefinition(
  name: string,
  cfg: StationCatalogConfig,
): AgentDefinition {
  // The argv IS the station: `tool_config` is typed `unknown` by the contracts
  // package, so `{ command: undefined }` compiles and seeds a recipe whose pod
  // has nothing to run. The committed file carries `command` on all eight
  // entries; a build that does not is drift worth stopping on.
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
        // A model credential only where the station actually calls a model.
        // "Stations omit it" held while every station was deterministic; one
        // that classifies a comment is not, and without the key it failed
        // invisibly.
        secrets: [
          { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
          ...(cfg.needs_model ? AGENT_SECRETS : []),
        ],
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
              // Same explicit ephemeral-storage as the agent template: ingest
              // and validate stations clone the repo too, and Autopilot's 1Gi
              // undeclared default is the eviction line.
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

/** The ai-agents-helm `files/catalog-seed.yaml` body: the seeded CRs, each
 *  annotated to survive uninstall.
 *
 *  NOT a template. The docs are applied SERVER-SIDE by the `catalog-seed`
 *  pre-upgrade hook, because Helm computes its patch by diffing the previous
 *  rendered manifest against the new one and never reads live state — so an
 *  object the API server pruned (a lagging CRD schema, #1301) stays pruned
 *  through every later deploy whose rendered text happens not to have changed.
 *  That is how `spec-analysis` and `feature-decompose` lost `output.watch` for
 *  eight days with nothing reporting it (#1468). `.Values.seedCatalog` still
 *  gates the seeding; the gate lives on the hook templates now. */
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
      // Literal (`|`), never folded (`>-`): a prompt carries an indented JSON schema
      // and code blocks, and folding rewraps them — the recipe the pod runs would
      // then differ from the task-types.yaml it was generated from, silently.
      { blockQuote: "literal" },
    ),
  );
  const body = `${header}---\n${docs.join("---\n")}`;

  // Guard the seeded mcp_servers block behind .Values.loreMcpUrl: with the gateway
  // URL unset (the default, and every cluster before the gateway is deployed) the
  // whole block is omitted, so recipe CRDs carry no empty-`url` MCP entry. The block
  // is the `mcp_servers:` line plus its more-indented list lines.
  const guarded = body.replace(
    /^( *)mcp_servers:\n((?:\1 .*\n)*)/gm,
    (_m, indent: string, items: string) =>
      `{{- if .Values.loreMcpUrl }}\n${indent}mcp_servers:\n${items}{{- end }}\n`,
  );

  // Same guard for the skills block, and for a sharper reason: an unset registry URL
  // renders `skills: [...]` beside `skills_source: null`, and that pair is not inert.
  // The subsystem's init runs its skills step, fetches nothing, reports SUCCESS — and
  // the agent container then dies on the `$HOME/.claude/settings.json` that step was
  // supposed to deliver. A recipe must never ask for skills it has no source for.
  const skillsGuarded = guarded.replace(
    /^( *)skills:\n((?:\1 .*\n)*)\1skills_source: (.*)\n/gm,
    (_m, indent: string, items: string, source: string) =>
      `{{- if .Values.loreSkillsUrl }}\n${indent}skills:\n${items}${indent}skills_source: ${source}\n{{- end }}\n`,
  );

  // Guard the http telemetry sink behind .Values.agentEventsUrl: the standalone
  // satellite chart has no bus-wide LORE_AGENT_INTERNAL_TOKEN to give this sink
  // (ADR-024's "no bus-wide credential leaves central" — the same restraint FR5
  // applies to LORE_INGEST_TOKEN), so it leaves agentEventsUrl unset and every
  // recipe's http sink must vanish rather than render pointed at an unreachable
  // URL with a secretKeyRef no satellite Secret can satisfy. An unguarded sink
  // is a hard CreateContainerConfigError on every satellite pod, of every node
  // type — found live, 2026-08-26.
  const sinksGuarded = skillsGuarded.replace(
    /^( *)- type: http\n\1 {2}url: .*\n\1 {2}headers_secret: agent-events-auth\n/gm,
    (match) => `{{- if .Values.agentEventsUrl }}\n${match}{{- end }}\n`,
  );

  // And the {context} placeholder, for the same reason one step further on. What
  // fills it is an INSTRUCTION to call lore_assemble_context — dispatch-time
  // hydration was removed 2026-08-28 — so it is only true where the pod has a Lore
  // MCP to call. A satellite renders no mcp_servers block (the gateway
  // authenticates with LORE_INGEST_TOKEN, and FR5 keeps that credential central),
  // and telling such a pod to call a tool it does not have burns a turn on a
  // guaranteed failure. Guarded on the same value as the block it points at, so the
  // two cannot drift apart (#1629).
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
