import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { buildMcpServer, type ServerMode } from "./build-mcp-server.js";
import { handleSkillsRequest } from "./skills-registry.js";

export interface HttpGatewayOptions {
  port: number;
  /** Required Bearer token; when unset, auth is disabled (local dev only). */
  authToken?: string;
  serverMode?: ServerMode;
}

/** Match the lore-api ingress cap so an authenticated-but-rogue pod can't OOM the gateway. */
const MAX_BODY_BYTES = 1024 * 1024;

// Bounds the per-session server map against leaked sessions (a pod that drops without DELETE, so `onclose` never fires); hitting it means a leak, so evict the oldest.
const MAX_SESSIONS = 1000;

/** An HTTP error carrying the status the gateway should return. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Reads the body with a hard size cap then parses JSON: malformed is 400, oversized is 413 — neither should surface as a 500.
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;

    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

/** What every /mcp handler needs: the live sessions and the gateway's own options. Grouped so the handlers stay module-level functions rather than closures inside the server factory. */
interface McpContext {
  sessions: Map<string, StreamableHTTPServerTransport>;
  opts: HttpGatewayOptions;
}

/** The per-process wiring every request needs but no request carries: where the skills bundle lives and how a caller proves it may reach /mcp. */
interface GatewayWiring {
  skillsRoot: string;
  authorized: (req: IncomingMessage) => boolean;
}

export function startHttpGateway(opts: HttpGatewayOptions): Server {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const wiring = gatewayWiring(opts);
  const mcp: McpContext = { sessions, opts };
  const server = createServer((req, res) => {
    void routeRequest(mcp, wiring, req, res).catch((err: unknown) =>
      reportUnhandled(res, err),
    );
  });

  server.listen(opts.port, () => {
    console.error(
      `[lore] MCP HTTP gateway listening on :${opts.port} (mode=${opts.serverMode ?? "full"}, auth=${opts.authToken ? "on" : "off"})`,
    );
  });

  return server;
}

// The agent-skills bundle baked into this gateway image; the subsystem init fetches it over /skills, which is not part of MCP.
function gatewayWiring(opts: HttpGatewayOptions): GatewayWiring {
  return {
    skillsRoot:
      process.env.LORE_AGENT_SKILLS_DIR ??
      resolve(process.cwd(), "agent-skills"),
    authorized: (req: IncomingMessage): boolean =>
      !opts.authToken ||
      req.headers.authorization === `Bearer ${opts.authToken}`,
  };
}

/** The gateway's four surfaces in precedence order: health (unauthenticated, for the probe), skills (unauthenticated — org conventions, not secrets), then /mcp behind the bearer. */
async function routeRequest(
  mcp: McpContext,
  wiring: GatewayWiring,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? "";

  if (await handledUnauthenticated(req, res, url, wiring.skillsRoot)) {
    return;
  }

  if (refusedBeforeMcp(wiring, req, res, url)) {
    return;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  await routeMcp(mcp, req, res, sessionId);
}

/** Health and skills, both deliberately open: the probe cannot hold a token, and the skills bundle is org conventions rather than secrets. Returns whether the request was answered here. */
async function handledUnauthenticated(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  skillsRoot: string,
): Promise<boolean> {
  if (isHealthzRequest(req, url)) {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");

    return true;
  }

  return handleSkillsRequest(req, res, skillsRoot);
}

/** True for the plain liveness probe — the one route with no `/mcp` or `/skills` prefix. */
function isHealthzRequest(req: IncomingMessage, url: string): boolean {
  return req.method === "GET" && url === "/healthz";
}

/** A 404 rather than a 401 on an unknown path, so an unauthenticated scan cannot map what exists here. Returns whether the request was already refused. */
function refusedBeforeMcp(
  wiring: GatewayWiring,
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): boolean {
  if (!url.startsWith("/mcp")) {
    res.writeHead(404).end();

    return true;
  }

  if (!wiring.authorized(req)) {
    jsonRpcError(res, 401, "Unauthorized");

    return true;
  }

  return false;
}

/** POST mints or resumes a session; GET/DELETE require an already-minted one; anything else 405s. */
async function routeMcp(
  ctx: McpContext,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string | undefined,
): Promise<void> {
  if (req.method === "POST") {
    await handleMcpPost(ctx, req, res, sessionId);

    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    await handleMcpSession(ctx.sessions, req, res, sessionId);

    return;
  }

  res.writeHead(405).end();
}

/** POST /mcp — an existing session's message, or an initialize minting one. */
async function handleMcpPost(
  ctx: McpContext,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string | undefined,
): Promise<void> {
  const body = await readJsonBody(req);
  let transport = sessionId ? ctx.sessions.get(sessionId) : undefined;

  if (!transport && !isInitializeRequest(body)) {
    jsonRpcError(res, 400, "No valid session — send initialize first");

    return;
  }

  if (!transport) {
    transport = newSession(ctx.opts, ctx.sessions);
  }
  await transport.handleRequest(req, res, body);
}

// A new McpServer + transport per MCP session (an McpServer binds to one transport), tracked by the session id the transport mints on initialize.
function newSession(
  opts: HttpGatewayOptions,
  sessions: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport {
  evictOldestWhenFull(sessions);
  const transport = trackedTransport(sessions);

  void buildMcpServer({ serverMode: opts.serverMode }).connect(transport);

  return transport;
}

// Map keeps insertion order, so the first key is the oldest session — evict it rather than let a leak grow the map unbounded.
function evictOldestWhenFull(
  sessions: Map<string, StreamableHTTPServerTransport>,
): void {
  const [oldestKey] = sessions.keys();
  const oldest = sessions.size >= MAX_SESSIONS ? oldestKey : undefined;

  if (!oldest) {
    return;
  }
  void sessions.get(oldest)?.close();
  sessions.delete(oldest);
}

// The transport mints the session id on initialize, so both registration and cleanup have to ride its own callbacks rather than be done by the caller.
function trackedTransport(
  sessions: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // Lore's tools are request/response, so a single JSON reply is simpler for clients than an SSE stream.
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  return transport;
}

/** GET/DELETE /mcp — stream or teardown on an already-minted session. */
async function handleMcpSession(
  sessions: McpContext["sessions"],
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string | undefined,
): Promise<void> {
  const transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    jsonRpcError(res, 400, "Unknown or missing session");

    return;
  }
  await transport.handleRequest(req, res);
}

// Serves MCP over Streamable HTTP so headless agent pods reach the same toolset the stdio adapter exposes: one shared gateway, per-session servers.
/** An error escaping a handler still owes the client a reply — but only if nothing has been written yet, since a streamed response cannot be turned back into an error. A 500 carries the raw error; anything else is already a message meant for the caller. */
function reportUnhandled(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    return;
  }
  const status = statusOf(err);

  jsonRpcError(
    res,
    status,
    status === 500 ? `gateway error: ${String(err)}` : (err as Error).message,
  );
}

function statusOf(err: unknown): number {
  return err instanceof HttpError ? err.status : 500;
}

function jsonRpcError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32001 : -32000, message },
      id: null,
    }),
  );
}
