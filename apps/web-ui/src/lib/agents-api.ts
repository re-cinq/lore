import type { AgentDefinition } from "./agents-mirror";

// Server-to-server client for the mcp-server agents API. Reads (resolved
// definitions) and writes (create/update/delete) all route through the gated
// endpoint — image changes need the CODEOWNERS approval-PR header. The admin
// token never reaches the browser (these run only in Server Actions / RSC).

export type AgentSaveResult =
  | { status: "ok"; agent: AgentDefinition }
  | { status: "two_key_required"; detail: string }
  | { status: "codeowners_failed"; code: string; detail: string }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

function cfg(): { apiUrl: string; token: string } | null {
  const apiUrl = process.env.LORE_API_URL;
  // Prefer the admin token; fall back to the legacy full-access ingest token,
  // which is what local dev (and the web-ui→mcp proxy) configures. The mcp route
  // enforces admin scope on writes — the legacy token satisfies it.
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
    const data = (await res.json()) as { agents?: AgentDefinition[] };

    return data.agents ?? [];
  } catch {
    return [];
  }
}

/** The org-default catalog — org rows overlaid on the yaml fallback, no
 *  per-repo layer. Feeds the global /agents page. */
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
    const data = (await res.json()) as { agents?: AgentDefinition[] };

    return data.agents ?? [];
  } catch {
    return [];
  }
}

export interface AgentUsageRef {
  blueprint: string;
  node_id: string;
  inherited: boolean;
}

/**
 * Where each catalog entry is dispatched from — every builtin blueprint node
 * that resolves to it, keyed by definition name. A name absent from the map is
 * either a blueprint-less task type (runs as a single Agent CR) or dormant;
 * the list view tells the two apart by the definition's execution_mode.
 *
 * NULL, not `{}`, when the endpoint is unreachable or refuses: an empty map
 * asserts "nothing references anything", and the list would then claim every
 * definition runs outside any assembly line — a wrong statement dressed as a
 * fact (a stale lore-api 404'd exactly this way). Unknown must render as
 * unknown.
 */
export async function fetchAgentUsage(): Promise<Record<
  string,
  AgentUsageRef[]
> | null> {
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
    const data = (await res.json()) as {
      usage?: Array<{ name: string; used_by: AgentUsageRef[] }>;
    };

    return Object.fromEntries(
      (data.usage ?? []).map((entry) => [entry.name, entry.used_by]),
    );
  } catch {
    return null;
  }
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

/** Update an ORG-DEFAULT definition — the global /agents editor's write. The
 *  API refuses a non-empty image here (repo-scoped two-key ceremony), which
 *  surfaces as a plain error result. */
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
  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (res.ok) {
    return { status: "ok", agent: data.agent as AgentDefinition };
  }

  if (res.status === 403 && data.error === "two_key_required") {
    return { status: "two_key_required", detail: String(data.detail ?? "") };
  }

  if (res.status === 403 && data.error === "codeowners_check_failed") {
    return {
      status: "codeowners_failed",
      code: String(data.code ?? "unknown"),
      detail: String(data.detail ?? ""),
    };
  }

  return {
    status: "error",
    message: String(data.error ?? `HTTP ${res.status}`),
  };
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
  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  return {
    status: "error",
    message: String(data.error ?? `HTTP ${res.status}`),
  };
}
