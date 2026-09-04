import { errorMessage } from "@re-cinq/lore-shared";
import {
  unreachableError,
  deniedError,
  notConfiguredError,
  textResult,
  type ProxyResult,
} from "./deps.js";

// Lore's own /api/tasks wire response (mirrors pipeline.tasks columns).
// eslint-disable-next-line lore/no-row-types-outside-models
export type RemoteTaskLite = {
  id: string;
  target_repo?: string;
  task_type?: string;
  issue_number?: number;
  description?: string;
  status?: string;
  context_bundle?: { spec_task_id?: string };
};

export type TaskGroupResponse = {
  total: number;
  completed: number;
  tasks: RemoteTaskLite[];
};
export type SyncTasksResponse = {
  parsed: number;
  synced: number;
  created: number;
};
export type ToolText = { content: [{ type: "text"; text: string }] };

export function completeOnly(body: string): boolean {
  try {
    return (JSON.parse(body) as { complete?: boolean }).complete === true;
  } catch {
    return false;
  }
}

export function toolText(text: string): ToolText {
  return textResult(text);
}

export function undetectedRepoError(): ToolText {
  return toolText("Could not detect repo. Specify repo parameter.");
}

export interface ApiCredentials {
  apiUrl: string;
  token: string;
}

export function resolveApiCredentials(): ApiCredentials | null {
  const apiUrl = process.env.LORE_API_URL || "";
  const token = process.env.LORE_INGEST_TOKEN || "";

  return apiUrl && token ? { apiUrl, token } : null;
}

export function isAuthDenied(status: number): boolean {
  return status === 401 || status === 403;
}

/** Maps every failure reason of a resolved (non-ok) ProxyResult to its tool text. */
function describeProxyFailure(
  proxied: Extract<ProxyResult, { ok: false }>,
  op: string,
  toolName: string,
  subject?: string,
): ToolText {
  if (proxied.reason === "not_configured") {
    return notConfiguredError(op);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  // A non-retriable status means the server answered and refused (e.g. 409); reporting "unreachable" would wrongly blame the network for the server's verdict.
  if (proxied.status) {
    return toolText(`The Lore API refused ${op}: ${proxied.detail}`);
  }

  return subject
    ? toolText(
        `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
      )
    : unreachableError(op, proxied.detail);
}

// Runs a proxied call and maps every failure (no pool per ADR-032: config gap, denial, outage) to its own tool text rather than a misleading "requires PostgreSQL".
export async function proxiedText(
  call: () => Promise<ProxyResult>,
  {
    op,
    toolName,
    subject,
    render,
  }: {
    op: string;
    toolName: string;
    /** Set for reads: names what could not be fetched, with no write-loss copy. */
    subject?: string;
    render: (body: unknown) => string;
  },
): Promise<ToolText> {
  try {
    const proxied = await call();

    if (proxied.ok) {
      return toolText(render(JSON.parse(proxied.body)));
    }

    return describeProxyFailure(proxied, op, toolName, subject);
  } catch (err) {
    return toolText(`Error ${op}: ${errorMessage(err)}`);
  }
}

function formatPendingTasksByRepo(tasks: RemoteTaskLite[]): string {
  const byRepo = new Map<string, RemoteTaskLite[]>();

  for (const t of tasks) {
    const r = t.target_repo || "unknown";
    const repoTasks = byRepo.get(r) ?? [];

    repoTasks.push(t);
    byRepo.set(r, repoTasks);
  }
  const sections: string[] = [];

  for (const [r, repoTasks] of byRepo) {
    const lines = repoTasks.map(
      (t) =>
        `  ${t.id.substring(0, 8)} ${t.task_type} ${t.issue_number ? "#" + t.issue_number + " " : ""}${(t.description || "").substring(0, 80)}`,
    );

    sections.push(`**${r}** (${repoTasks.length})\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function filterByRepo(
  tasks: RemoteTaskLite[],
  filterRepo: string | undefined,
): RemoteTaskLite[] {
  return filterRepo ? tasks.filter((t) => t.target_repo === filterRepo) : tasks;
}

function noPendingTasksMessage(filterRepo: string | undefined): string {
  return filterRepo
    ? `No pending tasks for ${filterRepo}.`
    : "No pending tasks.";
}

/** The pending-task list via the API, grouped by repo; null when the API is unavailable. */
export async function listPendingTasksViaApi(
  filterRepo: string | undefined,
): Promise<{ content: Array<{ type: "text"; text: string }> } | null> {
  const creds = resolveApiCredentials();

  if (!creds) {
    return null;
  }
  const resp = await fetch(
    `${creds.apiUrl}/api/tasks?status=pending&limit=50`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${creds.token}` },
    },
  );

  if (!resp.ok) {
    return null;
  }
  const body = (await resp.json()) as { tasks?: RemoteTaskLite[] };
  const tasks = filterByRepo(body.tasks || [], filterRepo);

  if (tasks.length === 0) {
    return textResult(noPendingTasksMessage(filterRepo));
  }

  return textResult(formatPendingTasksByRepo(tasks));
}
