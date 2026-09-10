import type { AgentDefinition } from "./agents-mirror";

// Server-to-server client for the mcp-server agents API — image changes need the CODEOWNERS approval-PR header; admin token never reaches the browser.
export type AgentSaveResult =
  | { status: "ok"; agent: AgentDefinition }
  | { status: "two_key_required"; detail: string }
  | { status: "codeowners_failed"; code: string; detail: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function listAgents(repo: string): Promise<AgentDefinition[]> {
  return await fetchAgentList(`/api/repos/${repo}/agent-definitions`);
}

/** The org-default catalog — org rows overlaid on the yaml fallback, no per-repo layer. Feeds the global /agents page. */
export async function listOrgAgents(): Promise<AgentDefinition[]> {
  return await fetchAgentList("/api/agent-definitions");
}

/** One cluster's verdict on one definition, from the sync loop's report. */
export interface AgentApplyStatus {
  name: string;
  project_id: string | null;
  cluster: string;
  state: "applied" | "refused" | "skipped" | "deleted";
  reason: string | null;
}

export interface AgentUsageRef {
  blueprint: string;
  node_id: string;
  inherited: boolean;
}

/** Where each catalog entry is dispatched from, keyed by name; null (not `{}`) when the endpoint is unreachable, so "unknown" never renders as "nothing references anything". */
export interface AgentUsage {
  refs: Record<string, AgentUsageRef[]>;
  /** Verdicts keyed by definition name — an empty list means no cluster has reported, not "applied everywhere". */
  applied: Record<string, AgentApplyStatus[]>;
}

/** The usage endpoint's wire shape, before it is keyed by name. */
interface AgentUsageBody {
  usage?: Array<{ name: string; used_by: AgentUsageRef[] }>;
  applied?: AgentApplyStatus[];
}

export async function fetchAgentUsage(): Promise<AgentUsage | null> {
  const c = cfg();

  if (!c) {
    return null;
  }

  try {
    const res = await fetch(`${c.apiUrl}/api/agent-definitions/usage`, {
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${c.token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return null;
    }

    return buildAgentUsage((await res.json()) as AgentUsageBody);
  } catch {
    return null;
  }
}

/** POSTs to the collection, so a name that already has a repo row is rejected by the API rather than silently overwritten. */
export function createAgent(
  repo: string,
  def: Partial<AgentDefinition> & { name: string },
  approvalPr?: string,
): Promise<AgentSaveResult> {
  return writeAgent(repo, def, { name: undefined, method: "POST" }, approvalPr);
}

/** PUTs to the named resource, which upserts the repo's PROJECT row — an org definition forks into a repo-owned one on its first edit. */
export function updateAgent(
  repo: string,
  def: Partial<AgentDefinition> & { name: string },
  approvalPr?: string,
): Promise<AgentSaveResult> {
  return writeAgent(repo, def, { name: def.name, method: "PUT" }, approvalPr);
}

/** Global /agents editor's write — API refuses a non-empty image here (repo-scoped two-key ceremony), surfacing as a plain error. */
export async function saveOrgAgent(
  def: Partial<AgentDefinition> & { name: string },
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }

  return writeDefinition({
    url: `${c.apiUrl}/api/agent-definitions/${encodeURIComponent(def.name)}`,
    method: "PUT",
    headers: writeHeaders(c.token),
    body: JSON.stringify(def),
  });
}

export async function deleteAgent(
  repo: string,
  name: string,
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }

  return deleteDefinition(agentUrl(c.apiUrl, repo, name), c.token, name);
}

/** A catalog read: an unreachable or unhappy endpoint reads as an empty catalog, never as a thrown render. */
async function fetchAgentList(path: string): Promise<AgentDefinition[]> {
  const c = cfg();

  if (!c) {
    return [];
  }

  try {
    const res = await fetch(`${c.apiUrl}${path}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${c.token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as { agents?: AgentDefinition[] };

    return body.agents ?? [];
  } catch {
    return [];
  }
}

function buildAgentUsage(body: AgentUsageBody): AgentUsage {
  return {
    refs: Object.fromEntries(
      (body.usage ?? []).map((entry) => [entry.name, entry.used_by]),
    ),
    applied: groupAppliedByName(body.applied ?? []),
  };
}

async function writeAgent(
  repo: string,
  def: Partial<AgentDefinition> & { name: string },
  target: { name: string | undefined; method: "POST" | "PUT" },
  approvalPr?: string,
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }

  return writeDefinition({
    url: agentUrl(c.apiUrl, repo, target.name),
    method: target.method,
    headers: writeHeaders(c.token, approvalPr),
    body: JSON.stringify(def),
  });
}

async function deleteDefinition(
  url: string,
  token: string,
  name: string,
): Promise<AgentSaveResult> {
  let res: Response;

  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  return res.ok ? deletedResult(name) : await readErrorBody(res);
}

function groupAppliedByName(
  statuses: AgentApplyStatus[],
): Record<string, AgentApplyStatus[]> {
  const applied: Record<string, AgentApplyStatus[]> = {};

  for (const status of statuses) {
    (applied[status.name] ??= []).push(status);
  }

  return applied;
}

function cfg(): { apiUrl: string; token: string } | null {
  const apiUrl = process.env.LORE_API_URL;
  // Prefer the admin token; the legacy full-access ingest token (local dev default) also satisfies the mcp route's admin-scope check.
  const token = process.env.LORE_ADMIN_TOKEN || process.env.LORE_INGEST_TOKEN;

  return apiUrl && token ? { apiUrl, token } : null;
}

interface WriteRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** One definition write; a transport failure becomes a result rather than a throw. */
async function writeDefinition(req: WriteRequest): Promise<AgentSaveResult> {
  let res: Response;

  try {
    res = await fetch(req.url, {
      signal: AbortSignal.timeout(15_000),
      method: req.method,
      headers: req.headers,
      body: req.body,
      cache: "no-store",
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  return mapWriteResponse(res);
}

/** The repo-scoped collection, or one definition inside it when named. */
function agentUrl(apiUrl: string, repo: string, name?: string): string {
  const base = `${apiUrl}/api/repos/${repo}/agent-definitions`;

  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

/** Headers for a definition write. The approval-PR header rides along only when there is one — the two-key gate on privileged fields reads it, and sending an empty value would be a claim of approval nobody made. */
function writeHeaders(
  token: string,
  approvalPr?: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    ...(approvalPr ? { "x-lore-approval-pr": approvalPr } : {}),
  };
}

/** The failure the API reported, falling back to the status code. The body is parsed defensively because an error response is exactly the case where it may not be JSON at all — a gateway timeout answers in HTML. */
async function readErrorBody(res: Response): Promise<AgentSaveResult> {
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  return {
    status: "error",
    message: String(body.error ?? `HTTP ${res.status}`),
  };
}

/** A delete answers with no body, so the name is all the caller gets back. */
function deletedResult(name: string): AgentSaveResult {
  return { status: "ok", agent: { name } as AgentDefinition };
}

async function mapWriteResponse(res: Response): Promise<AgentSaveResult> {
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (res.ok) {
    return { status: "ok", agent: body.agent as AgentDefinition };
  }

  return mapErrorBody(res.status, body);
}

function mapErrorBody(
  status: number,
  body: Record<string, unknown>,
): AgentSaveResult {
  if (status !== 403) {
    return genericSaveError(status, body);
  }

  if (body.error === "two_key_required") {
    return { status: "two_key_required", detail: stringField(body.detail) };
  }

  if (body.error === "codeowners_check_failed") {
    return {
      status: "codeowners_failed",
      code: stringField(body.code, "unknown"),
      detail: stringField(body.detail),
    };
  }

  return genericSaveError(status, body);
}

function genericSaveError(
  status: number,
  body: Record<string, unknown>,
): AgentSaveResult {
  return { status: "error", message: String(body.error ?? `HTTP ${status}`) };
}

function stringField(value: unknown, fallback = ""): string {
  return String(value ?? fallback);
}
