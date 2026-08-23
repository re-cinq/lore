// Running a station that lives in the stations service.
//
// A station in the service-endpoint form (ADR-024) is reached by name over
// HTTP; the caller gets back the same summary line the job always returned, so
// the Floor's scheduler can close its `pipeline.job_runs` row with it exactly as
// before. The Floor still owns WHEN; the service owns WHAT.
//
// A refusal throws. The scheduler records a failed job_run from it, which is the
// honest outcome — a sweep that did not run must not be logged as one that did.

/** Longer than the reporter's: a sweep walks every repo, and the caller is a
 *  cron tick with nobody waiting on it. Short enough that a wedged service
 *  cannot hold a scheduler slot indefinitely. */
const TIMEOUT_MS = 120_000;

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

    if (!res.ok) {
      throw new Error(`station "${name}" failed: ${res.status}`);
    }
    const body = (await res.json()) as { summary?: string };

    return body.summary ?? "";
  }
}
