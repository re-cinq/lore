/**
 * Standalone entrypoint for the LoreTask controller.
 *
 * Usage:
 *   node dist/loretask-controller-main.js
 */

import { createServer } from "node:http";
import { startController } from "./loretask-controller.js";

const PORT = parseInt(process.env.HEALTH_PORT || "8081", 10);

async function main(): Promise<void> {
  console.log("[controller] LoreTask controller starting...");
  await startController();

  // Health endpoint for K8s probes
  createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  }).listen(PORT, () => {
    console.log(`[controller] Health server on :${PORT}/healthz`);
  });

  console.log("[controller] LoreTask controller ready");
}

main().catch((err) => {
  console.error("[controller] Fatal:", err);
  process.exit(1);
});
