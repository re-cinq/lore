// Shared helpers for the registerXTools(server) modules: the API proxy surface plus the latency tracker; the adapter holds no DB pool (ADR-032).
import { trackToolCall } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { traceTool } from "@re-cinq/lore-server-core/platform/otel.js";

// The API proxy client lives in server-core; re-exported so tool modules keep importing it from `./deps.js` unchanged.
export {
  proxyToApi,
  proxyMemory,
  proxyGetApi,
  withReadCache,
  unreachableError,
  deniedError,
  notConfiguredError,
  textResult,
  PROXY_RETRY_DELAYS_MS,
  type ProxyResult,
} from "@re-cinq/lore-server-core/proxy.js";

// --- Latency tracking helper (shared by tools that opt into it) ---
export async function trackLatency<T>(
  tool: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  let success = true;

  try {
    return await fn();
  } catch (err) {
    success = false;
    throw err;
  } finally {
    const latencyMs = Date.now() - start;

    trackToolCall(tool, latencyMs, success);
    traceTool(tool, latencyMs, success);
  }
}
