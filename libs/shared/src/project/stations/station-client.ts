// Station client calls stations service by name over HTTP (ADR-024); Floor owns WHEN, service owns WHAT.

/** Timeout balances full repo sweep against preventing wedged service from blocking. */
const TIMEOUT_MS = 120_000;

/** What the station route answers when one run is already in flight. */
const STATION_ALREADY_RUNNING = 409;

export class StationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Run the named station; resolves with its summary. */
  async run(name: string): Promise<string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    const res = await this.fetchImpl(
      `${this.baseUrl}/api/stations/${encodeURIComponent(name)}`,
      { method: "POST", headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    // 409 (overlap latch) is SKIP not failure: work not lost, next tick takes it.
    if (res.status === STATION_ALREADY_RUNNING) {
      return "skipped: already running";
    }

    if (!res.ok) {
      throw new Error(`station "${name}" failed: ${res.status}`);
    }
    const body = (await res.json()) as { summary?: string };

    return body.summary ?? "";
  }
}
