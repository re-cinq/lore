/**
 * The credential one Lore service presents to another.
 *
 * Two tokens exist and they are NOT interchangeable: `LORE_INGEST_TOKEN` is the
 * org-wide ingest credential that external callers and CI present to lore-api,
 * and `LORE_AGENT_INTERNAL_TOKEN` is the service-to-service one — already what
 * the Floor's own `internal-token` auth strategy accepts on `/api/agent-events`.
 *
 * They drifted apart in the 2026-08-24 cutover: the event-router, stations and
 * cluster-agent charts all mount the INTERNAL token, while the Floor's clients
 * were sending the INGEST one. The two secrets hold different values, so every
 * Floor call to a new service answered 401 — the event drain, station runs and
 * agent dispatch all at once. Nothing caught it because each end was correct on
 * its own; only the pair was wrong.
 *
 * The fallback is for local dev, where `scripts/dev-local.sh` sets one token and
 * both ends read it.
 */
export function internalToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.LORE_AGENT_INTERNAL_TOKEN || env.LORE_INGEST_TOKEN;
}
