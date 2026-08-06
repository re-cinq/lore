import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer, type ServerMode } from "./build-mcp-server.js";
import type { ToolDeps } from "../mcp/tools/deps.js";

export interface HttpGatewayOptions {
  port: number;
  /** Required Bearer token; when unset, auth is disabled (local dev only). */
  authToken?: string;
  serverMode?: ServerMode;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");

  return raw ? JSON.parse(raw) : undefined;
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

/**
 * A new McpServer + transport per MCP session (an McpServer binds to one
 * transport), tracked by the session id the transport mints on initialize.
 */
function newSession(
  deps: ToolDeps,
  opts: HttpGatewayOptions,
  sessions: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // Lore's tools are request/response, so a single JSON reply is enough —
    // simpler for clients than an SSE stream.
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
  void buildMcpServer(deps, { serverMode: opts.serverMode }).connect(transport);

  return transport;
}

/**
 * Serve MCP over Streamable HTTP so headless agent pods can reach the same
 * toolset the stdio adapter exposes. One shared gateway; per-session servers.
 */
export function startHttpGateway(
  deps: ToolDeps,
  opts: HttpGatewayOptions,
): Server {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const authorized = (req: IncomingMessage): boolean =>
    !opts.authToken || req.headers.authorization === `Bearer ${opts.authToken}`;

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      if (!res.headersSent) {
        jsonRpcError(res, 500, `gateway error: ${String(err)}`);
      }
    });
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "";

    if (req.method === "GET" && url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");

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
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        if (!isInitializeRequest(body)) {
          jsonRpcError(res, 400, "No valid session — send initialize first");

          return;
        }
        transport = newSession(deps, opts, sessions);
      }
      await transport.handleRequest(req, res, body);

      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        jsonRpcError(res, 400, "Unknown or missing session");

        return;
      }
      await transport.handleRequest(req, res);

      return;
    }

    res.writeHead(405).end();
  }

  server.listen(opts.port, () => {
    console.error(
      `[lore] MCP HTTP gateway listening on :${opts.port} (mode=${opts.serverMode ?? "full"}, auth=${opts.authToken ? "on" : "off"})`,
    );
  });

  return server;
}
