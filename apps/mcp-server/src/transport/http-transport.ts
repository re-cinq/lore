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

function statusOf(err: unknown): number {
  return err instanceof HttpError ? err.status : 500;
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

/** True for the plain liveness probe — the one route with no `/mcp` or `/skills` prefix. */
function isHealthzRequest(req: IncomingMessage, url: string): boolean {
  return req.method === "GET" && url === "/healthz";
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

// A new McpServer + transport per MCP session (an McpServer binds to one transport), tracked by the session id the transport mints on initialize.
function newSession(
  opts: HttpGatewayOptions,
  sessions: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport {
  // Map keeps insertion order, so the first key is the oldest session — evict it rather than let a leak grow the map unbounded.
  const oldest =
    sessions.size >= MAX_SESSIONS ? sessions.keys().next().value : undefined;

  if (oldest) {
    void sessions.get(oldest)?.close();
    sessions.delete(oldest);
  }
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
  void buildMcpServer({ serverMode: opts.serverMode }).connect(transport);

  return transport;
}

// Serves MCP over Streamable HTTP so headless agent pods reach the same toolset the stdio adapter exposes: one shared gateway, per-session servers.
export function startHttpGateway(opts: HttpGatewayOptions): Server {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // The agent-skills bundle baked into this gateway image; the subsystem init fetches it over /skills, not part of MCP.
  const skillsRoot =
    process.env.LORE_AGENT_SKILLS_DIR ?? resolve(process.cwd(), "agent-skills");

  const authorized = (req: IncomingMessage): boolean =>
    !opts.authToken || req.headers.authorization === `Bearer ${opts.authToken}`;

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        const status = statusOf(err);
        const message =
          status === 500
            ? `gateway error: ${String(err)}`
            : (err as Error).message;

        jsonRpcError(res, status, message);
      }
    });
  });

  // POST mints or resumes a session; GET/DELETE require an already-minted one; anything else 405s.
  async function routeMcp(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string | undefined,
  ): Promise<void> {
    if (req.method === "POST") {
      await handleMcpPost(req, res, sessionId);

      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      await handleMcpSession(req, res, sessionId);

      return;
    }

    res.writeHead(405).end();
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "";

    if (isHealthzRequest(req, url)) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");

      return;
    }

    // Skills registry (unauthenticated — org conventions, not secrets). Owns /skills/*.
    if (await handleSkillsRequest(req, res, skillsRoot)) {
      return;
    }

    if (!url.startsWith("/mcp")) {
      res.writeHead(404).end();

      return;
    }

    if (!authorized(req)) {
      jsonRpcError(res, 401, "Unauthorized");

      return;
    }

    await routeMcp(
      req,
      res,
      req.headers["mcp-session-id"] as string | undefined,
    );
  }

  /** POST /mcp — an existing session's message, or an initialize minting one. */
  async function handleMcpPost(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string | undefined,
  ): Promise<void> {
    const body = await readJsonBody(req);
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport && !isInitializeRequest(body)) {
      jsonRpcError(res, 400, "No valid session — send initialize first");

      return;
    }

    if (!transport) {
      transport = newSession(opts, sessions);
    }
    await transport.handleRequest(req, res, body);
  }

  /** GET/DELETE /mcp — stream or teardown on an already-minted session. */
  async function handleMcpSession(
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

  server.listen(opts.port, () => {
    console.error(
      `[lore] MCP HTTP gateway listening on :${opts.port} (mode=${opts.serverMode ?? "full"}, auth=${opts.authToken ? "on" : "off"})`,
    );
  });

  return server;
}
