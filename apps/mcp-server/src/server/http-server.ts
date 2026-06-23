import { createServer } from "node:http";
import { traceHttp } from "@re-cinq/lore-server-core/platform/otel.js";
import { handleApiRoute } from "../api/routes.js";

const MAX_BODY_BYTES = 1_048_576; // 1MB

/**
 * Start the REST API (/api/*) on the configured PORT. The GKE deployment is a
 * REST backend; the MCP protocol is served only by the local stdio adapter,
 * which wraps these routes. The former /mcp endpoint was dormant and
 * unauthenticated, so it was removed (see docs/mcp-transport-options.md).
 */
export async function startHttpServer(getPool: () => any): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);

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
    const handled = await handleApiRoute(req, res, getPool());
    if (!handled) res.writeHead(404).end();
    traceHttp(req.method || "GET", req.url || "/", res.statusCode, Date.now() - reqStart);
  });
  httpServer.listen(port, () => {
    console.log(`MCP server (HTTP REST API) listening on :${port}`);
  });
}
