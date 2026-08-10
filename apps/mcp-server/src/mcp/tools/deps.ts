/**
 * Shared helpers for the registerXTools(server) modules: the API proxy surface
 * plus the latency tracker. The adapter holds no DB pool at all (ADR-032) — it
 * proxies every data operation to lore-api.
 */
import { trackToolCall } from "@re-cinq/lore-server-core/platform/session-tracker.js";
import { traceTool } from "@re-cinq/lore-server-core/platform/otel.js";

// The API proxy client lives in server-core (shared infra). Re-exported here so
// the tool modules keep importing it from `./deps.js` unchanged.
export {
  proxyToApi,
  proxyMemory,
  proxyGetApi,
  withReadCache,
  unreachableError,
  deniedError,
  notConfiguredError,
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
