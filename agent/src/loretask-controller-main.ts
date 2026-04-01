/**
 * Standalone entrypoint for the LoreTask controller.
 *
 * Run this as a separate deployment from the main agent worker
 * when you want the controller in its own pod (e.g., a Deployment
 * with replicas: 1 and a leader election sidecar).
 *
 * Usage:
 *   node dist/loretask-controller-main.js
 */

import { startController } from "./loretask-controller.js";

async function main(): Promise<void> {
  console.log("[controller] LoreTask controller starting...");
  await startController();
  console.log("[controller] LoreTask controller ready");
}

main().catch((err) => {
  console.error("[controller] Fatal:", err);
  process.exit(1);
});
