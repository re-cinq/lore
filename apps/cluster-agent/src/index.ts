/**
 * The cluster agent: the only process that talks to this cluster's Kubernetes
 * API. It holds no database — every caller brings its own state and asks this
 * for cluster operations only.
 */

import { startServer } from "./delivery/server.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

async function main(): Promise<void> {
  const stopServer = await startServer(PORT);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[cluster-agent] ${signal} — shutting down`);
    await stopServer();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[cluster-agent] fatal:", err);
  process.exit(1);
});
