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

/** Per-cluster values the Helm chart used to substitute into the seed; each cluster-agent supplies its own from env (ADR-024). Unset OMITS the block it feeds — a recipe pointing at an unreachable URL fails worse than one without it. */
export interface CatalogCrdOptions {
  /** Telemetry sink URL (D8); unset omits the http sink AND its secret ref. */
  eventsUrl?: string;
  /** Live Lore MCP gateway; unset omits mcp_servers + the {context} placeholder (#1629, guarded together). */
  mcpUrl?: string;
  /** The gateway's /skills registry; unset omits skills + skills_source. */
  skillsUrl?: string;
  /** The Lore API base every lore-station pod calls; unset omits the env var. */
  apiUrl?: string;
  /** LLM credential key in this cluster's agent-secrets Secret; unset omits the secret ref (CreateContainerConfigError otherwise). Fallback alias for modelSecretKeys.anthropic. */
  llmSecretKey?: string;
  /** Credential key per model family this cluster can serve; a family absent here is a REFUSAL (validateCatalogEntry), never a silently wrong secret (gemini-2.5-pro incident, 2026-09-01). */
  modelSecretKeys?: Record<string, string>;
  /** The lore-station image (per-cluster tag pin) station-mode rows run on. */
  stationImage?: string;
  /** Overrides config.env LORE_DGRAPH_HTTP (row stores the GKE endpoint verbatim); a minikube cluster repoints it here. */
  dgraphUrl?: string;
}

/** CRD name for a catalog row; a per-repo override folds the project id in — two repos overriding the same task type used to collide on one CR name, last save winning. */
export function catalogCrdName(
  baseName: string,
  projectId: string | null,
): string {
  return projectId
    ? `${baseName}--r${projectId.replace(/-/g, "").slice(0, 8)}`
    : baseName;
}

// RFC-1123 subdomain the apiserver accepts; a row outside it (e.g. def-github_action) 422s permanently and head-of-line-blocked the sync tail for 2h (2026-09-01).
const K8S_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Credential family for a model id, or null when none claims it — a typo'd model must refuse, not borrow a key. */
export function modelFamily(model: string): string | null {
  if (model.startsWith("claude")) {
    return "anthropic";
  }

  if (model.startsWith("gemini")) {
    return "gemini";
  }

  if (model.startsWith("gpt") || /^o\d/.test(model)) {
    return "openai";
  }

  return null;
}

/** Family→key map; legacy llmSecretKey WINS the anthropic slot when set (explicit per-cluster override) so it isn't silently shadowed by the chart's default map. */
function secretKeysOf(opts: CatalogCrdOptions): Record<string, string> {
  return {
    ...(opts.modelSecretKeys ?? {}),
    ...(opts.llmSecretKey ? { anthropic: opts.llmSecretKey } : {}),
  };
}

/** Render contract: why this entry must NOT be applied here, or null when it may. Called before render so a bad row degrades to a refused entry (previous CR stays live) instead of an unbootable pod (2026-09-01 incident class); reasons are permanent for this (row, cluster) pair. */
export function validateCatalogEntry(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): string | null {
  const name = catalogCrdName(def.name, def.project_id);
  const keys = secretKeysOf(opts);
  // Empty map = bare cluster rendering no secret refs on purpose; any configured key makes credential coverage checkable.
  const checkFamilies = Object.keys(keys).length > 0;

  if (!K8S_NAME.test(name) || name.length > 253) {
    return `"${name}" is not a valid Kubernetes resource name`;
  }

  if (def.execution_mode === "station") {
    // needs_model station calls Anthropic (stationSpec renders the key) — guards the silent-drop comment-triage failure.
    const missingModelCredential =
      def.config?.needs_model && checkFamilies && !keys.anthropic;

    return missingModelCredential
      ? `station ${def.name} needs a model but this cluster holds no anthropic credential`
      : null;
  }

  if (!def.prompt) {
    return `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`;
  }

  // Same default the render uses — validate and render must never disagree on the effective family.
  const family = def.model ? modelFamily(def.model) : "anthropic";

  if (family === null) {
    return `model "${def.model}" belongs to no known credential family (anthropic/gemini/openai)`;
  }

  if (checkFamilies && !keys[family]) {
    return `this cluster holds no credential for the "${family}" family (model "${def.model ?? "(default)"}") — configure modelSecretKeys and seed the key before pointing a recipe at it`;
  }

  return null;
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

function llmSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  // Unreachable: agentDefToCrds already ran validateCatalogEntry's promptless refusal; kept for the type narrowing below.
  enforceTrue(
    def.prompt,
    Error,
    `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`,
  );

  // Key follows the MODEL's family, not the cluster's habit — must never disagree with validateCatalogEntry's default family.
  const family = def.model ? modelFamily(def.model) : "anthropic";
  const secretKey = family ? secretKeysOf(opts)[family] : undefined;

  return {
    description: `Lore ${def.name} recipe.`,
    ...(def.model ? { model: def.model } : {}),
    // {context} filled per run with CONTEXT_BOOTSTRAP; only true where the pod has a Lore MCP to call (#1629).
    prompt: opts.mcpUrl
      ? `${def.prompt.trimEnd()}\n\n{context}`
      : def.prompt.trimEnd(),
    permission_mode: "bypass",
    max_turns: AGENT_MAX_TURNS,
    resources: {
      ...(secretKey ? { secrets: [{ name: secretKey, ref: secretKey }] } : {}),
      // Every agent pod commits its own work; git refuses without an identity and a pod has no ambient git config.
      env: GIT_IDENTITY,
      ...(opts.mcpUrl
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
        : {}),
      // A recipe's own skills APPEND to lore-context rather than replacing it.
      ...(opts.skillsUrl
        ? {
            skills: [
              "lore-context",
              ...(def.config?.skills ?? []).filter(
                (name) => name !== "lore-context",
              ),
            ],
            skills_source: opts.skillsUrl,
          }
        : {}),
    },
    // Defense-in-depth: an agent must never spawn more pipeline work from inside a run; recipe denies (#1160) append after.
    disallowed_tools: [
      "mcp__lore__lore_create_pipeline_task",
      ...(def.config?.disallowed_tools ?? []),
    ],
    output: sinksFor(def, opts),
  };
}

/** exec-vendor recipe (ADR-031): non-LLM node run by lore-station's entrypoint; whole node input rides {station_input}. */
function stationSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  const anthropicKey = secretKeysOf(opts).anthropic;
  const envEntries = Object.entries(def.config?.env ?? {}).map(
    ([name, value]) => ({
      name,
      // Row stores the central cluster's dgraph endpoint verbatim; a cluster with dgraph elsewhere substitutes its own.
      value:
        name === "LORE_DGRAPH_HTTP" && opts.dgraphUrl ? opts.dgraphUrl : value,
    }),
  );

  return {
    description: `Lore ${def.name} station recipe.`,
    model: "exec",
    prompt: "{station_input}",
    permission_mode: "bypass",
    max_turns: 1,
    tool_config: {
      command: def.config?.command ?? [
        "lore-station",
        def.name.replace(/^def-/, ""),
      ],
    },
    resources: {
      // Every station pod reads/writes over HTTP (createStationProject, D7); API base URL ships on every recipe, per-station env appends.
      env: [
        ...(opts.apiUrl ? [{ name: "LORE_API_URL", value: opts.apiUrl }] : []),
        ...envEntries,
      ],
      // Model credential only where the station calls a model — comment-triage silently dropped a missing key into "ignore" and reported success.
      secrets: [
        { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
        // needs_model stations call Anthropic (comment-triage's Haiku); family-specific stations declare their own model instead.
        ...(def.config?.needs_model && anthropicKey
          ? [{ name: anthropicKey, ref: anthropicKey }]
          : []),
      ],
    },
    output: sinksFor(def, opts),
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
    station: {
      apiVersion: API_VERSION,
      kind: "Station",
      metadata: { name, labels: { ...SYNC_LABELS } },
      spec: {
        agentDefRef: name,
        deadlineMinutes: def.timeout_minutes ?? (isStation ? 15 : 30),
        template: {
          // Template labels survive the per-task Station clone + controller's label merge — the only marker a NetworkPolicy can key on that still matches pt-* pods.
          ...(def.config?.pod_labels &&
          Object.keys(def.config.pod_labels).length > 0
            ? { metadata: { labels: { ...def.config.pod_labels } } }
            : {}),
          spec: {
            containers: [
              {
                name: "agent",
                image:
                  def.image ??
                  (isStation ? (opts.stationImage ?? BASE_IMAGE) : BASE_IMAGE),
                ...(isStation || def.config?.repo_workdir === false
                  ? {}
                  : { workingDir: REPO_WORKDIR }),
                resources: mergePodResources(def.config?.pod_resources),
              },
            ],
          },
        },
      },
    },
  };
}
