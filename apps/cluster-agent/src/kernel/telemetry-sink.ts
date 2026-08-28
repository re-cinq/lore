/**
 * Where relayed agent telemetry goes: the Floor's NDJSON sink.
 *
 * NOT the event-router. Per-tool-call telemetry is not a bus event — the Floor
 * projects it into `pipeline.agent_run_events` / `agent_run_turns` / `llm_calls`
 * and fans it out over SSE, and putting that volume through `pipeline.events`
 * would abuse a dispatch queue built for handler fan-out and dedupe. The proxy
 * routes by message kind precisely so these two can share a queue and a retry
 * ladder without sharing a destination.
 *
 * The credential is a thunk for the same reason the reporter's is: a satellite
 * presents its per-agent token, which is re-minted on every re-registration,
 * and the Floor's sink accepts it against `pipeline.cluster_agents`.
 */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  ProxyMessage,
  Sink,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";

const TIMEOUT_MS = 30_000;

export class TelemetrySink implements Sink {
  constructor(
    private readonly floorUrl: string,
    private readonly token: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(message: ProxyMessage): Promise<void> {
    enforceTrue(
      message.kind === "telemetry",
      Error,
      `TelemetrySink received a ${message.kind} message — the proxy routes by kind and should never send one here`,
    );

    const token = this.token();
    const res = await this.fetchImpl(`${this.floorUrl}/api/agent-events`, {
      method: "POST",
      headers: {
        "content-type": "application/x-ndjson",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: message.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // The status rides on the throw so the proxy's ladder can tell a rotated
    // credential (401/403 → re-register, then retry) from a blip (retry as-is).
    // Collapsing them would make a satellite retry a refused token five times
    // and drop the batch, which is how the terminal-event outage worked.
    enforceTrue(
      res.ok,
      () =>
        Object.assign(new Error(`agent-events relay failed: ${res.status}`), {
          status: res.status,
        }),
      "",
    );
  }
}
