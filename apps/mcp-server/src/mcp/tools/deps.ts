/**
 * Shared dependency surface passed to every registerXTools(server, deps).
 *
 * The DB pool is created in main() AFTER tool registration, so tools must
 * read it lazily via getPool() rather than capturing a snapshot.
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
  PROXY_RETRY_DELAYS_MS,
  type ProxyResult,
} from "@re-cinq/lore-server-core/proxy.js";

export interface ToolDeps {
  /** Lazy accessor for the pg pool (null until main() initializes it). */
  getPool: () => any;
}

// --- Latency tracking helper (shared by tools that opt into it) ---
export function makeTrackLatency(getPool: () => any) {
  return async function trackLatency(tool: string, fn: () => Promise<any>): Promise<any> {
    const start = Date.now();
    let success = true;
    try {
      const result = await fn();
      return result;
    } catch (err) {
      success = false;
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      trackToolCall(tool, latencyMs, success);
      traceTool(tool, latencyMs, success);
      const pool = getPool();
      if (pool) {
        pool.query(
          `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ($1, $2, $3)`,
          ['system', tool, JSON.stringify({ latency_ms: latencyMs })],
        ).catch(() => {});
      }
    }
  };
}

