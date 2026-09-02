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
export const SYNC_MANAGED_BY = "lore-catalog-sync";
export const SYNC_LABELS = {
  "app.kubernetes.io/managed-by": SYNC_MANAGED_BY,
};
/** lore-api's push-path label (agents.ts applyCatalogCrd) — a render that is
 *  degraded on purpose to die with its writer. The sync loop OWNS these: its
 *  validated full render repairing a UI save is the point, and leaving them
 *  would freeze the degraded shape in place until cutover. */
export const UI_MANAGED_BY = "lore-catalog-ui";

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

/**
 * A `pod_resources` override merges per key ONTO the defaults — you say what
 * you mean to change, nothing else moves. Whole-object replacement is what
 * evicted every tdd-round pod at 1Gi of disk: a memory-only override dropped
 * the ephemeral-storage defaults, and on Autopilot an absent request backfills
 * to a bare 1Gi. The price is that a default cannot be UNSET, only overridden
 * with a bigger (or smaller) value — acceptable, since "no limit at all" is
 * not a shape the catalog means to offer.
 */
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
   *  CreateContainerConfigError on every run pod. The anthropic entry of
   *  {@link modelSecretKeys} in older spelling; kept as its fallback. */
  llmSecretKey?: string;
  /**
   * The credential key per MODEL FAMILY this cluster can serve — the
   * per-cluster fact that decides whether a definition naming a gemini model
   * renders at all here. One hardcoded key was how a `gemini-2.5-pro` edit
   * shipped a CR carrying ANTHROPIC_API_KEY (2026-09-01): the render cannot
   * invent a credential, so a family absent from this map is a REFUSAL
   * (validateCatalogEntry), never a silently wrong secret.
   */
  modelSecretKeys?: Record<string, string>;
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

/** RFC-1123 subdomain — what the apiserver accepts as a resource name. A row
 *  named outside it (`def-github_action`, an 0028 leftover) can NEVER apply:
 *  the 422 is permanent, and retrying it head-of-line-blocked the whole sync
 *  tail in production for two hours (2026-09-01). */
const K8S_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** The credential family a model id belongs to, or null for one no family
 *  claims — a typo'd model must refuse, not render with somebody's key. */
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

/** The family→key map in effect. The legacy `llmSecretKey` WINS the anthropic
 *  slot when set: it is the operator's explicit per-cluster override (a laptop's
 *  `CLAUDE_CODE_OAUTH_TOKEN`), and the chart ships a default map — map-wins
 *  would silently shadow that override with the GKE default and
 *  CreateContainerConfigError every run pod. Empty = a bare cluster rendering
 *  no secret refs. */
function secretKeysOf(opts: CatalogCrdOptions): Record<string, string> {
  return {
    ...(opts.modelSecretKeys ?? {}),
    ...(opts.llmSecretKey ? { anthropic: opts.llmSecretKey } : {}),
  };
}

/**
 * The render contract: why this entry must NOT be applied on this cluster, or
 * null when it may. Called by the sync loop BEFORE the render, so a bad row
 * degrades to a refused-with-reason entry (the previous CR stays live) instead
 * of an unbootable pod minutes later — the 2026-09-01 incident's whole class.
 * Every reason here is PERMANENT for this (row, cluster) pair: only a new
 * catalog event or new cluster config can change the answer, so the loop acks
 * past a refusal rather than re-serving it forever.
 */
export function validateCatalogEntry(
  def: ResolvedAgentDefinition,
  opts: CatalogCrdOptions,
): string | null {
  const name = catalogCrdName(def.name, def.project_id);
  const keys = secretKeysOf(opts);
  // An empty map is a bare cluster that renders no secret refs on purpose;
  // any configured key makes credential coverage a checkable claim.
  const checkFamilies = Object.keys(keys).length > 0;

  if (!K8S_NAME.test(name) || name.length > 253) {
    return `"${name}" is not a valid Kubernetes resource name`;
  }

  if (def.execution_mode === "station") {
    // A needs_model station calls Anthropic (stationSpec renders the
    // anthropic key) — the silent-drop comment-triage failure, guarded here
    // the same way LLM recipes are.
    if (def.config?.needs_model && checkFamilies && !keys.anthropic) {
      return `station ${def.name} needs a model but this cluster holds no anthropic credential`;
    }

    return null;
  }

  if (!def.prompt) {
    return `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`;
  }

  // The SAME default the render uses: a modelless recipe runs the subsystem's
  // claude default, so it needs the anthropic key exactly as a claude-* model
  // does — validate and render must never disagree on the effective family.
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
  // Unreachable: agentDefToCrds ran validateCatalogEntry first, whose
  // promptless refusal carries the same message. Kept as the type narrowing
  // the render below relies on.
  enforceTrue(
    def.prompt,
    Error,
    `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`,
  );

  // The key follows the MODEL's family, not the cluster's habit: a gemini
  // recipe rendered with ANTHROPIC_API_KEY is a pod that cannot call its model.
  // Same default family as validateCatalogEntry — the two must never disagree.
  const family = def.model ? modelFamily(def.model) : "anthropic";
  const secretKey = family ? secretKeysOf(opts)[family] : undefined;

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
      ...(secretKey ? { secrets: [{ name: secretKey, ref: secretKey }] } : {}),
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
  const anthropicKey = secretKeysOf(opts).anthropic;
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
        // needs_model stations call Anthropic (comment-triage's Haiku);
        // family-specific stations would declare their model instead.
        ...(def.config?.needs_model && anthropicKey
          ? [{ name: anthropicKey, ref: anthropicKey }]
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
                resources: mergePodResources(def.config?.pod_resources),
              },
            ],
          },
        },
      },
    },
  };
}
