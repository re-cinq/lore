import * as http from "node:http";
import * as k8s from "@kubernetes/client-node";
import { makeK8sDeps } from "./k8s-deps.js";
import { startWatching } from "./watch.js";

/**
 * Entry point for the Agent/Station/AgentDefinition controller (ADR-031).
 * Connects in-cluster when deployed, or via the local kubeconfig when developing
 * against a kind cluster; exposes /healthz for k8s probes; then watches Agents.
 */

const NAMESPACE = process.env.NAMESPACE || "lore-agents";
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 8081);

function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  // loadFromCluster() doesn't throw when the service-account env is absent — it just
  // builds a bogus server URL — so gate on the env Kubernetes injects into pods.
  if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
    console.log("[controller] loaded in-cluster config");
  } else {
    kc.loadFromDefault();
    console.log("[controller] loaded local kubeconfig (development)");
  }
  return kc;
}

function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // Don't let a busy port kill the controller — health is non-essential to reconciling.
  server.on("error", (err) => console.error(`[controller] health server error: ${(err as Error).message}`));
  server.listen(HEALTH_PORT, () => console.log(`[controller] health on :${HEALTH_PORT}`));
}

function main(): void {
  const kc = loadKubeConfig();
  startHealthServer();
  startWatching(kc, NAMESPACE, makeK8sDeps(kc, NAMESPACE));
  console.log(`[controller] watching Agents in namespace ${NAMESPACE}`);
}

main();
