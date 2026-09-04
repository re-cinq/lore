// Render-eligibility checks for a catalog row: why an entry must NOT be rendered on this cluster, or null when it may.

import type { ResolvedAgentDefinition } from "../../models/agent-definition.js";

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
export function secretKeysOf(opts: CatalogCrdOptions): Record<string, string> {
  return {
    ...(opts.modelSecretKeys ?? {}),
    ...(opts.llmSecretKey ? { anthropic: opts.llmSecretKey } : {}),
  };
}

function invalidCrdName(name: string): string | null {
  return !K8S_NAME.test(name) || name.length > 253
    ? `"${name}" is not a valid Kubernetes resource name`
    : null;
}

/** needs_model station calls Anthropic (stationSpec renders the key) — guards the silent-drop comment-triage failure. */
function validateStationEntry(
  def: ResolvedAgentDefinition,
  keys: Record<string, string>,
  checkFamilies: boolean,
): string | null {
  const missingModelCredential =
    def.config?.needs_model && checkFamilies && !keys.anthropic;

  return missingModelCredential
    ? `station ${def.name} needs a model but this cluster holds no anthropic credential`
    : null;
}

function missingModelCredentialMessage(
  def: ResolvedAgentDefinition,
  family: string,
): string {
  return `this cluster holds no credential for the "${family}" family (model "${def.model ?? "(default)"}") — configure modelSecretKeys and seed the key before pointing a recipe at it`;
}

function validateLlmEntry(
  def: ResolvedAgentDefinition,
  keys: Record<string, string>,
  checkFamilies: boolean,
): string | null {
  if (!def.prompt) {
    return `recipe ${def.name} has no prompt — the subsystem rejects a promptless AgentDefinition at admission`;
  }

  // Same default the render uses — validate and render must never disagree on the effective family.
  const family = def.model ? modelFamily(def.model) : "anthropic";

  if (family === null) {
    return `model "${def.model}" belongs to no known credential family (anthropic/gemini/openai)`;
  }

  return checkFamilies && !keys[family]
    ? missingModelCredentialMessage(def, family)
    : null;
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
  const nameError = invalidCrdName(name);

  if (nameError) {
    return nameError;
  }

  return def.execution_mode === "station"
    ? validateStationEntry(def, keys, checkFamilies)
    : validateLlmEntry(def, keys, checkFamilies);
}
