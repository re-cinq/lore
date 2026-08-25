// What a terminal Agent CR's status says.
//
// Here rather than in `libs/assembly-lines` because it is now a WIRE shape: the
// cluster agent reads it off the CR and serves it, the Floor consumes it over
// HTTP, and assembly-lines interprets it. That package depends on this one, so
// the declaration has to sit at the bottom for all three to share it.

export interface AgentNodeStatus {
  phase?: string;
  output?: string;
  failureReason?: string;
  /**
   * The agent's OWN terminal error text, lifted off the raw NDJSON stream before
   * anything unwrapped it (`terminalErrorText`). It has to be carried separately
   * because `output` is normalized at the read boundary, and the unwrapped text
   * no longer parses as a stream — so a reader downstream of the unwrap could
   * only see the Job-level `failureReason`, which says `BackoffLimitExceeded`
   * however the agent actually died.
   */
  errorText?: string;
}
