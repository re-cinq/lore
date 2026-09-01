// Catalog row → CRD pair: the ONE mapping from a resolved lore.agent_definitions
// row to the AgentDefinition + Station custom resources the ai-agent-subsystem
// resolves at dispatch. Successor to BOTH prior writers — the Helm catalog seed
// (apps/floor agent-catalog.ts, chart-sentinel-substituted) and lore-api's
// UI-authored mirror (features/agents/agent-crd.ts) — so every per-cluster value
// the chart used to template rides CatalogCrdOptions instead, supplied by each
// cluster-agent from its own environment. Pure + deterministic; the k8s apply is
// the caller's IO shell (paired-writes.ts).

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

// One writer, one label. The chart seed's `lore-catalog-seed` and the old push
// path's `lore-catalog-ui` both retire with their writers; during the overlap
// release the sync loop skips seed-labeled CRs (see catalog-sync-loop).
export const SYNC_LABELS = {
  "app.kubernetes.io/managed-by": "lore-catalog-sync",
};
export const SEED_MANAGED_BY = "lore-catalog-seed";

// Where the init clones the target repo, and therefore the only writable
// directory the agent prompts can mean by "the working directory". Left unset,
// the container inherits `/`, which is NOT writable (2026-08-10, minikube).
const REPO_WORKDIR = "/workspace/target";

/** The committer every Lore-authored commit carries, mirroring the Floor's
 *  GitCli env defaults so a pod's commit and a Floor's commit read the same. */
const GIT_IDENTITY = [
  { name: "GIT_AUTHOR_NAME", value: "Lore Agent" },
  { name: "GIT_AUTHOR_EMAIL", value: "lore-agent@re-cinq.com" },
  { name: "GIT_COMMITTER_NAME", value: "Lore Agent" },
  { name: "GIT_COMMITTER_EMAIL", value: "lore-agent@re-cinq.com" },
];

// Autopilot caps an undeclared pod at 1Gi ephemeral-storage and a clone +
// claude session blows through that and gets EVICTED mid-run (#1287/#1288).
const POD_RESOURCES = {
  requests: { cpu: "250m", memory: "512Mi", "ephemeral-storage": "2Gi" },
  limits: { cpu: "1", memory: "1Gi", "ephemeral-storage": "4Gi" },
};

export interface CrdPair {
  agentDefinition: AgentDefinition;
  station: Station;
}

/**
 * The per-cluster values the Helm chart used to substitute into the committed
 * seed (`catalogChartYaml`'s sentinels). Each cluster-agent supplies its own
 * from env — lore-api has no idea which cluster's URLs apply, and a satellite's
 * are deliberately different (most unset, per ADR-024's credential restraint).
 *
 * Every optional URL follows the seed's guard rule: unset OMITS the block it
 * feeds, because a recipe pointing at a URL the pod cannot reach fails worse
 * than one without it (mcp: wasted turns; skills: init "succeeds" then the
 * agent dies on the settings.json it never fetched; events sink: hard
 * CreateContainerConfigError on every satellite pod — all found live).
 */
export interface CatalogCrdOptions {
  /** Telemetry sink URL (D8); unset omits the http sink AND its secret ref. */
  eventsUrl?: string;
  /** The live Lore MCP gateway; unset omits mcp_servers AND the `{context}`
   *  placeholder that instructs the pod to call it (#1629 — guarded together). */
  mcpUrl?: string;
  /** The gateway's /skills registry; unset omits skills + skills_source. */
  skillsUrl?: string;
  /** The Lore API base every lore-station pod calls; unset omits the env var. */
  apiUrl?: string;
  /** The LLM credential key this cluster's agent-secrets Secret carries
   *  (ANTHROPIC_API_KEY on GKE, CLAUDE_CODE_OAUTH_TOKEN on a laptop). Unset
   *  omits the secret ref — a declared key missing from the Secret is a
   *  CreateContainerConfigError on every run pod. */
  llmSecretKey?: string;
  /** The lore-station image (per-cluster tag pin) station-mode rows run on. */
  stationImage?: string;
  /** Overrides a config.env LORE_DGRAPH_HTTP value — the row stores the GKE
   *  endpoint verbatim; a minikube cluster repoints it here. */
  dgraphUrl?: string;
}

/**
 * The CRD name for a catalog row. Org defaults keep the bare name; a per-repo
 * override folds the project id in — two repos overriding the same task type
 * used to collide on one cluster-wide CR name, and the last save silently
 * replaced the other repo's live recipe. Same shape as perTaskName's
 * `pt-<taskId8>` (per-task-token.ts), one dimension over.
 */
export function catalogCrdName(
  baseName: string,
  projectId: string | null,
): string {
  return projectId
    ? `${baseName}--r${projectId.replace(/-/g, "").slice(0, 8)}`
    : baseName;
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
    // A recipe whose deliverable is a file declares it; the subsystem raises it
    // as a named `kind:"file"` event once the agent exits — the only way the
    // artifact leaves the pod (ai-agent-subsystem#188, lost for 8 days in #1468).
    ...(def.config?.watch ? { watch: [def.config.watch] } : {}),
  };
}

function llmSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  // The subsystem rejects a promptless AgentDefinition at admission
  // (ai-agent-subsystem#155); failing here beats an opaque apply rejection.
  enforceTrue(def.prompt, Error, `recipe ${def.name} has no prompt`);

  return {
    description: `Lore ${def.name} recipe.`,
    ...(def.model ? { model: def.model } : {}),
    // {context} is filled per run with CONTEXT_BOOTSTRAP — an instruction to
    // call lore_assemble_context, so it is only true where the pod has a Lore
    // MCP to call (#1629: guarded on the same value as the block it points at).
    prompt: opts.mcpUrl
      ? `${def.prompt.trimEnd()}\n\n{context}`
      : def.prompt.trimEnd(),
    permission_mode: "bypass",
    max_turns: AGENT_MAX_TURNS,
    resources: {
      ...(opts.llmSecretKey
        ? { secrets: [{ name: opts.llmSecretKey, ref: opts.llmSecretKey }] }
        : {}),
      // Every agent pod commits its own work; git refuses without an identity
      // and a pod has no ambient git config.
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
    // Defense-in-depth (the gateway already omits it in agent mode): an agent
    // must never spawn more pipeline work from inside a run. Recipe-declared
    // denies (#1160) append after.
    disallowed_tools: [
      "mcp__lore__lore_create_pipeline_task",
      ...(def.config?.disallowed_tools ?? []),
    ],
    output: sinksFor(def, opts),
  };
}

/** exec-vendor recipe (ADR-031 amendment): a non-LLM node run by the pod's
 *  `lore-station <type>` entrypoint; the whole node input rides {station_input}. */
function stationSpec(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): AgentDefinitionSpec {
  const envEntries = Object.entries(def.config?.env ?? {}).map(
    ([name, value]) => ({
      name,
      // The row stores the central cluster's dgraph endpoint verbatim; a
      // cluster whose dgraph lives elsewhere substitutes its own.
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
      // Every station pod reads/writes over HTTP (createStationProject, D7),
      // so the API base URL ships on every recipe; per-station env appends.
      env: [
        ...(opts.apiUrl ? [{ name: "LORE_API_URL", value: opts.apiUrl }] : []),
        ...envEntries,
      ],
      // A model credential only where the station actually calls a model —
      // comment-triage swallowed its missing key into `ignore` and reported
      // success, silently dropping every human PR comment.
      secrets: [
        { name: "LORE_INGEST_TOKEN", ref: "LORE_INGEST_TOKEN" },
        ...(def.config?.needs_model && opts.llmSecretKey
          ? [{ name: opts.llmSecretKey, ref: opts.llmSecretKey }]
          : []),
      ],
    },
    output: sinksFor(def, opts),
  };
}

/**
 * A resolved catalog row as the AgentDefinition + Station CR pair a cluster
 * applies. `execution_mode: 'station'` rows render the exec-vendor shape on the
 * lore-station image; everything else renders the LLM shape on the base image.
 */
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
          // Template labels survive the per-task Station clone AND the
          // controller's label merge — the only marker a NetworkPolicy can key
          // on that still matches pt-* pods.
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
                resources: def.config?.pod_resources ?? POD_RESOURCES,
              },
            ],
          },
        },
      },
    },
  };
}
