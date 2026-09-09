// The factory's stop button for an account-wide LLM outage (#1455) — a blocked run is PARKED (not failed) via the reaper's existing re-drive, and state is in-memory since floor-helm pins `replicaCount: 1`.

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

  /** Report failure: returns true iff THIS call tripped gate; caller logs outage once. */
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

/** Shared gate: node-event trips it, credit-probe clears it; must be single instance. */
export const llmDispatchGate = new LlmDispatchGate();
