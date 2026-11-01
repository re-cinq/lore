import { errorMessage } from "@re-cinq/lore-shared";
import {
  unreachableError,
  deniedError,
  unconfiguredError,
  textResult,
  type ProxyResult,
} from "../../shared/deps.js";

// Lore's own /api/tasks wire response (mirrors pipeline.tasks columns).
// eslint-disable-next-line re-lint/no-row-types-outside-models
export type RemoteTaskLite = {
  id: string;
  target_repo?: string;
  task_type?: string;
  issue_number?: number;
  description?: string;
  status?: string;
  context_bundle?: { spec_task_id?: string };
};

export type ToolText = { content: [{ type: "text"; text: string }] };

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

export interface ProxiedTextOptions {
  op: string;
  toolName: string;
  /** Set for reads: names what could not be fetched, with no write-loss copy. */
  subject?: string;
  render: (body: unknown) => string;
}

// Runs a proxied call and maps every failure (no pool per ADR-032: config gap, denial, outage) to its own tool text rather than a misleading "requires PostgreSQL".
export async function proxiedText(
  call: () => Promise<ProxyResult>,
  { op, toolName, subject, render }: ProxiedTextOptions,
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

/** Maps every failure reason of a resolved (non-ok) ProxyResult to its tool text. */
function describeProxyFailure(
  proxied: Extract<ProxyResult, { ok: false }>,
  op: string,
  toolName: string,
  subject?: string,
): ToolText {
  if (proxied.reason === "not_configured") {
    return unconfiguredError(op);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return describeProxyOutage(proxied, op, subject);
}

// A non-retriable status means the server answered and refused (e.g. 409); reporting "unreachable" would wrongly blame the network for the server's verdict.
function describeProxyOutage(
  proxied: Extract<ProxyResult, { reason: "unreachable" }>,
  op: string,
  subject?: string,
): ToolText {
  if (proxied.status) {
    return toolText(`The Lore API refused ${op}: ${proxied.detail}`);
  }

  return subject
    ? toolText(
        `Could not fetch ${subject} from the Lore API: ${proxied.detail}`,
      )
    : unreachableError(op, proxied.detail);
}

function toolText(text: string): ToolText {
  return textResult(text);
}
