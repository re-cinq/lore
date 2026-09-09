// Where relayed agent telemetry goes: the Floor's NDJSON sink, NOT the event-router — per-tool-call volume would abuse pipeline.events' fan-out/dedupe queue. Credential is a thunk since the per-agent token re-mints on re-registration.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  ProxyMessage,
  Sink,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";

const TIMEOUT_MS = 30_000;

// The status rides ON the thrown error so the proxy's ladder can tell a rotated credential (401/403) from a blip — collapsing them retries a refused token and drops the batch.
function relayError(status: number): () => Error {
  return () =>
    Object.assign(new Error(`agent-events relay failed: ${status}`), {
      status,
    });
}

export class TelemetrySink implements Sink {
  constructor(
    private readonly floorUrl: string,
    private readonly token: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // NDJSON, with this cluster's token when it has one. An unregistered relay still posts — the Floor decides whether to accept it, and dropping the batch here would lose telemetry the run cannot re-emit.
  private relayHeaders(): Record<string, string> {
    const token = this.token();

    return {
      "content-type": "application/x-ndjson",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  async deliver(message: ProxyMessage): Promise<void> {
    enforceTrue(
      message.kind === "telemetry",
      Error,
      `TelemetrySink received a ${message.kind} message — the proxy routes by kind and should never send one here`,
    );

    const res = await this.fetchImpl(`${this.floorUrl}/api/agent-events`, {
      method: "POST",
      headers: this.relayHeaders(),
      body: message.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    enforceTrue(res.ok, relayError(res.status), "");
  }
}
