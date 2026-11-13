// The MCP servers of an agent definition as the form edits them: a draft holds every input as text, a server is what the API takes (`config.mcp_servers`, the floor's shape).

export type McpTransport = "stdio" | "http" | "sse";

/** A header or env var the server needs, valued from the key `ref` of the cluster's agent-secrets. */
export interface SecretRef {
  name: string;
  ref: string;
}

export interface McpServer {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers_secret?: string;
  headers?: SecretRef[];
  env?: SecretRef[];
}

export interface McpServerDraft {
  name: string;
  transport: McpTransport;
  url: string;
  command: string;
  /** Space-separated, as typed. */
  args: string;
  headersSecret: string;
  /** Headers of an http or sse server, env vars of a stdio one. */
  secrets: SecretRef[];
}

export const EMPTY_SERVER: McpServerDraft = {
  name: "",
  transport: "http",
  url: "",
  command: "",
  args: "",
  headersSecret: "",
  secrets: [],
};

export function draftOf(server: McpServer): McpServerDraft {
  return {
    name: server.name,
    transport: server.transport,
    url: orBlank(server.url),
    command: orBlank(server.command),
    args: orBlank(server.args?.join(" ")),
    headersSecret: orBlank(server.headers_secret),
    secrets: secretsOf(server),
  };
}

function orBlank(text: string | undefined): string {
  return text ?? "";
}

function secretsOf(server: McpServer): SecretRef[] {
  return (server.transport === "stdio" ? server.env : server.headers) ?? [];
}

/** The servers the drafts describe; a draft with no name is a row not filled in yet. */
export function serversOf(drafts: McpServerDraft[]): McpServer[] {
  return drafts.filter((draft) => draft.name.trim() !== "").map(serverOf);
}

function serverOf(draft: McpServerDraft): McpServer {
  const secrets = filledSecrets(draft.secrets);
  const identity = { name: draft.name.trim(), transport: draft.transport };

  return draft.transport === "stdio"
    ? { ...identity, ...processOf(draft), ...listed("env", secrets) }
    : { ...identity, ...addressOf(draft), ...listed("headers", secrets) };
}

function processOf(draft: McpServerDraft): Partial<McpServer> {
  const words = draft.args.split(/\s+/);
  const args = words.filter(Boolean);

  return { ...texted("command", draft.command), ...listed("args", args) };
}

function addressOf(draft: McpServerDraft): Partial<McpServer> {
  return {
    ...texted("url", draft.url),
    ...texted("headers_secret", draft.headersSecret),
  };
}

function filledSecrets(secrets: SecretRef[]): SecretRef[] {
  return secrets
    .map(({ name, ref }) => ({ name: name.trim(), ref: ref.trim() }))
    .filter(({ name, ref }) => name !== "" && ref !== "");
}

function texted(key: keyof McpServer, text: string): Partial<McpServer> {
  return text.trim() === "" ? {} : { [key]: text.trim() };
}

function listed(key: keyof McpServer, entries: unknown[]): Partial<McpServer> {
  return entries.length === 0 ? {} : { [key]: entries };
}

/** The servers an agent's resolved config holds. */
export function configuredServers(config: unknown): McpServer[] {
  const servers = (config as { mcp_servers?: McpServer[] } | null)?.mcp_servers;

  return servers ?? [];
}

/** The form's `mcp_servers` field: absent while the servers are untouched (the save keeps the stored list), an empty list once every server was removed (a repo then runs none of the org default's). */
export function parseMcpServers(form: FormData): McpServer[] | undefined {
  const field = form.get("mcp_servers");

  return typeof field === "string"
    ? (JSON.parse(field) as McpServer[])
    : undefined;
}
