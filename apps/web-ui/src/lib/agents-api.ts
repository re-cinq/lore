import type { AgentDefinition } from "./agents-mirror";

// Server-to-server client for the mcp-server agents API — image changes need the CODEOWNERS approval-PR header; admin token never reaches the browser.
export type AgentSaveResult =
  | { status: "ok"; agent: AgentDefinition }
  | { status: "two_key_required"; detail: string }
  | { status: "codeowners_failed"; code: string; detail: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

function cfg(): { apiUrl: string; token: string } | null {
  const apiUrl = process.env.LORE_API_URL;
  // Prefer the admin token; the legacy full-access ingest token (local dev default) also satisfies the mcp route's admin-scope check.
  const token = process.env.LORE_ADMIN_TOKEN || process.env.LORE_INGEST_TOKEN;

  return apiUrl && token ? { apiUrl, token } : null;
}

export async function listAgents(repo: string): Promise<AgentDefinition[]> {
  const c = cfg();

  if (!c) {
    return [];
  }

  try {
    const res = await fetch(`${c.apiUrl}/api/repos/${repo}/agent-definitions`, {
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

/** The org-default catalog — org rows overlaid on the yaml fallback, no per-repo layer. Feeds the global /agents page. */
export async function listOrgAgents(): Promise<AgentDefinition[]> {
  const c = cfg();

  if (!c) {
    return [];
  }

  try {
    const res = await fetch(`${c.apiUrl}/api/agent-definitions`, {
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
    const body = (await res.json()) as {
      usage?: Array<{ name: string; used_by: AgentUsageRef[] }>;
      applied?: AgentApplyStatus[];
    };

    return buildAgentUsage(body);
  } catch {
    return null;
  }
}

function buildAgentUsage(body: {
  usage?: Array<{ name: string; used_by: AgentUsageRef[] }>;
  applied?: AgentApplyStatus[];
}): AgentUsage {
  return {
    refs: Object.fromEntries(
      (body.usage ?? []).map((entry) => [entry.name, entry.used_by]),
    ),
    applied: groupAppliedByName(body.applied ?? []),
  };
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

export async function saveAgent(
  repo: string,
  def: Partial<AgentDefinition> & { name: string },
  isUpdate: boolean,
  approvalPr?: string,
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${c.token}`,
  };

  if (approvalPr) {
    headers["x-lore-approval-pr"] = approvalPr;
  }

  const url = isUpdate
    ? `${c.apiUrl}/api/repos/${repo}/agent-definitions/${encodeURIComponent(def.name)}`
    : `${c.apiUrl}/api/repos/${repo}/agent-definitions`;

  let res: Response;

  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      method: isUpdate ? "PUT" : "POST",
      headers,
      body: JSON.stringify(def),
      cache: "no-store",
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  return mapWriteResponse(res);
}

/** Global /agents editor's write — API refuses a non-empty image here (repo-scoped two-key ceremony), surfacing as a plain error. */
export async function saveOrgAgent(
  def: Partial<AgentDefinition> & { name: string },
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }
  let res: Response;

  try {
    res = await fetch(
      `${c.apiUrl}/api/agent-definitions/${encodeURIComponent(def.name)}`,
      {
        signal: AbortSignal.timeout(15_000),
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.token}`,
        },
        body: JSON.stringify(def),
        cache: "no-store",
      },
    );
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  return mapWriteResponse(res);
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

function stringField(value: unknown, fallback = ""): string {
  return String(value ?? fallback);
}

function genericSaveError(
  status: number,
  body: Record<string, unknown>,
): AgentSaveResult {
  return { status: "error", message: String(body.error ?? `HTTP ${status}`) };
}

export async function deleteAgent(
  repo: string,
  name: string,
): Promise<AgentSaveResult> {
  const c = cfg();

  if (!c) {
    return { status: "unconfigured" };
  }
  let res: Response;

  try {
    res = await fetch(
      `${c.apiUrl}/api/repos/${repo}/agent-definitions/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(15_000),
        method: "DELETE",
        headers: { authorization: `Bearer ${c.token}` },
        cache: "no-store",
      },
    );
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  if (res.ok) {
    return { status: "ok", agent: { name } as AgentDefinition };
  }
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  return {
    status: "error",
    message: String(body.error ?? `HTTP ${res.status}`),
  };
}
