// The factory's stop button for an account-wide LLM outage (#1455).
//
// On 2026-08-20 the Anthropic account ran dry and the Floor kept dispatching into
// it for two hours: twelve pods, twelve `npm ci` bootstraps, twelve user-visible
// failures somebody then had to retry by hand. Every one of them was decided
// before the pod started — the account had no credit, so the run had no chance.
//
// A blocked run is PARKED, never failed: `advanceLine` returns before it mints a
// station-run row, so the run stays `running` with no open node and the reaper's
// existing "running, no open node -> advanceLine" arm re-drives it every 60s at
// no cost. Nothing is finished, so no failure notice fires and no author is told
// their work died. When the gate clears, the walk simply carries on.
//
// State is in-memory, which is sound for the same reason the SSE bus and the
// billing-alert throttle are: floor-helm pins `replicaCount: 1`. It is also cold
// on boot, so a rollout mid-outage re-opens the gate and the next failure re-trips
// it — one wasted pod per rollout, against a durable flag that would need a write
// path the Floor's read-only settings binding does not have.

/** Failure classes that mean the ACCOUNT is down, not this run. */
const ACCOUNT_WIDE = new Set<string>(["anthropic-credit"]);

/** Said when the account tripped the gate without any text to quote. */
const DEFAULT_CAUSE = "the Anthropic account is out of credits";

export interface LlmDispatchGateState {
  blocked: boolean;
  cause: string | null;
  since: Date | null;
}

export class LlmDispatchGate {
  private since: Date | null = null;
  private cause: string | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Report a classified node failure. Returns true only when THIS call tripped
   * the gate — the caller uses that to log the outage once rather than once per
   * drowned run.
   *
   * A rate limit deliberately does not trip it: it clears on its own, and parking
   * the whole factory on one would wedge more work than it saves.
   */
  trip(failureClass: string, detail?: string): boolean {
    if (!ACCOUNT_WIDE.has(failureClass) || this.since !== null) {
      return false;
    }
    this.since = this.now();
    this.cause = detail ?? DEFAULT_CAUSE;

    return true;
  }

  /** Let dispatch through again. Returns whether it had been blocked. */
  clear(): boolean {
    const wasBlocked = this.since !== null;

    this.since = null;
    this.cause = null;

    return wasBlocked;
  }

  isBlocked(): boolean {
    return this.since !== null;
  }

  state(): LlmDispatchGateState {
    return {
      blocked: this.since !== null,
      cause: this.cause,
      since: this.since,
    };
  }
}
