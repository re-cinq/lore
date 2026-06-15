import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { traceHttp } from "../platform/otel.js";
import { handleApiRoute } from "../api/routes.js";

const MAX_BODY_BYTES = 1_048_576; // 1MB

/**
 * Start the Streamable-HTTP transport + the /api route dispatcher on the
 * configured PORT. getPool returns the live pg pool for API route handlers.
 */
export async function startHttpServer(server: McpServer, getPool: () => any): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });

  const httpServer = createServer(async (req, res) => {
    // Enforce body size limit on all POST requests
    if (req.method === "POST") {
      const contentLength = parseInt(req.headers["content-length"] || "0", 10);
      if (contentLength > MAX_BODY_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "request body too large" }));
        return;
      }
    }

    const reqStart = Date.now();
    if (req.url === "/mcp" || req.url === "/mcp/") {
      await transport.handleRequest(req, res);
    } else {
      const handled = await handleApiRoute(req, res, getPool());
      if (!handled) res.writeHead(404).end();
    }
    traceHttp(req.method || "GET", req.url || "/", res.statusCode, Date.now() - reqStart);
  });
  await server.connect(transport);
  httpServer.listen(port, () => {
    console.log(`MCP server (HTTP) listening on :${port}/mcp`);
  });
}
