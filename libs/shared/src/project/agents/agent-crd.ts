// Catalog row → AgentDefinition+Station CRD pair (dispatch-time render); successor to both prior writers (floor agent-catalog.ts, lore-api's UI-authored agent-crd.ts).

import type {
  AgentDefinition,
  AgentDefinitionSpec,
  Station,
  OutputSink,
} from "@re-cinq/agent-contracts";
import { enforceTrue } from "../../lib/enforce.js";
import { AGENT_MAX_TURNS } from "../../cluster/agent-limits.js";
import type { ResolvedAgentDefinition } from "../../models/agent-definition.js";
import {
  type CatalogCrdOptions,
  catalogCrdName,
  modelFamily,
  secretKeysOf,
} from "./agent-crd-validation.js";

export {
  type CatalogCrdOptions,
  catalogCrdName,
  modelFamily,
  validateCatalogEntry,
} from "./agent-crd-validation.js";

const API_VERSION = "agents.re-cinq.com/v1alpha1";
// glibc base; the subsystem's init container injects the claude runtime + supervisor.
const BASE_IMAGE = "node:22-bookworm";

// One writer, one label — old writers' labels retire with them; the sync loop skips seed-labeled CRs (see catalog-sync-loop).
export const SYNC_MANAGED_BY = "lore-catalog-sync";
export const SYNC_LABELS = {
  "app.kubernetes.io/managed-by": SYNC_MANAGED_BY,
};
/** lore-api's push-path label — a degraded render meant to die with its writer; the sync loop owns repair until cutover. */
export const UI_MANAGED_BY = "lore-catalog-ui";

// Only writable dir agent prompts can mean by "working directory"; unset inherits `/`, which is NOT writable (2026-08-10, minikube).
const REPO_WORKDIR = "/workspace/target";

/** Committer every Lore-authored commit carries, mirroring the Floor's GitCli env defaults. */
const GIT_IDENTITY = [
  { name: "GIT_AUTHOR_NAME", value: "Lore Agent" },
  { name: "GIT_AUTHOR_EMAIL", value: "lore-agent@re-cinq.com" },
  { name: "GIT_COMMITTER_NAME", value: "Lore Agent" },
  { name: "GIT_COMMITTER_EMAIL", value: "lore-agent@re-cinq.com" },
];

// Autopilot caps an undeclared pod at 1Gi ephemeral-storage; a clone + claude session blows through that and gets EVICTED mid-run (#1287/#1288).
const POD_RESOURCES = {
  requests: { cpu: "250m", memory: "512Mi", "ephemeral-storage": "2Gi" },
  limits: { cpu: "1", memory: "1Gi", "ephemeral-storage": "4Gi" },
};

/** pod_resources override merges per-key onto defaults (never whole-object) — whole-object replace evicted every tdd-round pod at 1Gi by dropping the ephemeral-storage default. */
function mergePodResources(override?: {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}) {
  if (!override) {
    return POD_RESOURCES;
  }

  return {
    requests: { ...POD_RESOURCES.requests, ...override.requests },
    limits: { ...POD_RESOURCES.limits, ...override.limits },
  };
}

export interface CrdPair {
  agentDefinition: AgentDefinition;
  station: Station;
}

function sinksFor(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): Pick<NonNullable<AgentDefinitionSpec["output"]>, "sinks" | "watch"> {
  const sinks: OutputSink[] = [{ type: "stdout" }];

  if (opts.eventsUrl) {
    sinks.push({
      type: "http",
      url: opts.eventsUrl,
      headers_secret: "agent-events-auth",
    });
  }

  return {
    sinks,
    // A file-deliverable recipe declares watch; the subsystem raises it as a kind:"file" event on exit — the only way the artifact leaves the pod (ai-agent-subsystem#188, lost 8 days in #1468).
    ...(def.config?.watch ? { watch: [def.config.watch] } : {}),
  };
}

/** {context} filled per run with CONTEXT_BOOTSTRAP; only true where the pod has a Lore MCP to call (#1629). */
function llmPrompt(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): string {
  // Unreachable: agentDefToCrds already ran validateCatalogEntry's promptless refusal; kept for the type narrowing below.
  enforceTrue(
    def.prompt,
    Error,
    `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`,
  );

  return opts.mcpUrl
    ? `${def.prompt.trimEnd()}\n\n{context}`
    : def.prompt.trimEnd();
}

function llmSecretsBlock(secretKey: string | undefined) {
  return secretKey ? { secrets: [{ name: secretKey, ref: secretKey }] } : {};
}

function mcpServersBlock(opts: CatalogCrdOptions) {
  return opts.mcpUrl
    ? {
        mcp_servers: [
          {
            name: "lore",
            transport: "http" as const,
            url: opts.mcpUrl,
            headers_secret: "lore-mcp-auth",
          },
        ],
      }
    : {};
}

/** A recipe's own skills APPEND to lore-context rather than replacing it. */
function skillsBlock(def: ResolvedAgentDefinition, opts: CatalogCrdOptions) {
  return opts.skillsUrl
    ? {
        skills: [
          "lore-context",
          ...(def.config?.skills ?? []).filter(
            (name) => name !== "lore-context",
          ),
        ],
        skills_source: opts.skillsUrl,
      }
    : {};
}

function llmResources(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
  secretKey: string | undefined,
) {
  return {
    ...llmSecretsBlock(secretKey),
    // Every agent pod commits its own work; git refuses without an identity and a pod has no ambient git config.
    env: GIT_IDENTITY,
    ...mcpServersBlock(opts),
    ...skillsBlock(def, opts),
  };
}

function llmSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  // Key follows the MODEL's family, not the cluster's habit — must never disagree with validateCatalogEntry's default family.
  const family = def.model ? modelFamily(def.model) : "anthropic";
  const secretKey = family ? secretKeysOf(opts)[family] : undefined;

  return {
    description: `Lore ${def.name} recipe.`,
    ...(def.model ? { model: def.model } : {}),
    prompt: llmPrompt(def, opts),
    permission_mode: "bypass",
    max_turns: AGENT_MAX_TURNS,
    resources: llmResources(def, opts, secretKey),
    // Defense-in-depth: an agent must never spawn more pipeline work from inside a run; recipe denies (#1160) append after.
    disallowed_tools: [
      "mcp__lore__lore_create_pipeline_task",
      ...(def.config?.disallowed_tools ?? []),
    ],
    output: sinksFor(def, opts),
  };
}

function stationCommand(def: ResolvedAgentDefinition): unknown {
  return def.config?.command ?? ["lore-station", def.name.replace(/^def-/, "")];
}

/** Row stores the central cluster's dgraph endpoint verbatim; a cluster with dgraph elsewhere substitutes its own. */
function stationEnvEntries(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
) {
  return Object.entries(def.config?.env ?? {}).map(([name, value]) => ({
    name,
    value:
      name === "LORE_DGRAPH_HTTP" && opts.dgraphUrl ? opts.dgraphUrl : value,
  }));
}

/** Every station pod reads/writes over HTTP (createStationProject, D7); API base URL ships on every recipe, per-station env appends. */
function stationEnv(def: ResolvedAgentDefinition, opts: CatalogCrdOptions) {
  return [
    ...(opts.apiUrl ? [{ name: "LORE_API_URL", value: opts.apiUrl }] : []),
    ...stationEnvEntries(def, opts),
  ];
}

/** Model credential only where the station calls a model — comment-triage silently dropped a missing key into "ignore" and reported success. */
function stationSecrets(
  def: ResolvedAgentDefinition,
  anthropicKey: string | undefined,
) {
  return [
    { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
    // needs_model stations call Anthropic (comment-triage's Haiku); family-specific stations declare their own model instead.
    ...(def.config?.needs_model && anthropicKey
      ? [{ name: anthropicKey, ref: anthropicKey }]
      : []),
  ];
}

/** exec-vendor recipe (ADR-031): non-LLM node run by lore-station's entrypoint; whole node input rides {station_input}. */
function stationSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  const anthropicKey = secretKeysOf(opts).anthropic;

  return {
    description: `Lore ${def.name} station recipe.`,
    model: "exec",
    prompt: "{station_input}",
    permission_mode: "bypass",
    max_turns: 1,
    tool_config: { command: stationCommand(def) },
    resources: {
      env: stationEnv(def, opts),
      secrets: stationSecrets(def, anthropicKey),
    },
    output: sinksFor(def, opts),
  };
}

/** Template labels survive the per-task Station clone + controller's label merge — the only marker a NetworkPolicy can key on that still matches pt-* pods. */
function templateLabels(def: ResolvedAgentDefinition) {
  const labels = def.config?.pod_labels;

  return labels && Object.keys(labels).length > 0
    ? { metadata: { labels: { ...labels } } }
    : {};
}

function containerImage(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
  isStation: boolean,
): string {
  if (def.image) {
    return def.image;
  }

  return isStation ? (opts.stationImage ?? BASE_IMAGE) : BASE_IMAGE;
}

function containerWorkingDir(
  def: ResolvedAgentDefinition,
  isStation: boolean,
): { workingDir?: string } {
  if (isStation || def.config?.repo_workdir === false) {
    return {};
  }

  return { workingDir: REPO_WORKDIR };
}

function agentContainer(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
  isStation: boolean,
) {
  return {
    name: "agent",
    image: containerImage(def, opts, isStation),
    ...containerWorkingDir(def, isStation),
    resources: mergePodResources(def.config?.pod_resources),
  };
}

function stationCrd(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
  name: string,
  isStation: boolean,
): Station {
  return {
    apiVersion: API_VERSION,
    kind: "Station",
    metadata: { name, labels: { ...SYNC_LABELS } },
    spec: {
      agentDefRef: name,
      deadlineMinutes: def.timeout_minutes ?? (isStation ? 15 : 30),
      template: {
        ...templateLabels(def),
        spec: {
          containers: [agentContainer(def, opts, isStation)],
        },
      },
    },
  };
}

/** Resolved catalog row → AgentDefinition+Station CR pair; execution_mode:'station' rows render the exec-vendor shape on lore-station image, others render the LLM shape on the base image. */
export function agentDefToCrds(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions = {},
): CrdPair {
  const isStation = def.execution_mode === "station";
  const name = catalogCrdName(def.name, def.project_id);

  return {
    agentDefinition: {
      apiVersion: API_VERSION,
      kind: "AgentDefinition",
      metadata: { name, labels: { ...SYNC_LABELS } },
      spec: isStation ? stationSpec(def, opts) : llmSpec(def, opts),
    },
    station: stationCrd(def, opts, name, isStation),
  };
}
