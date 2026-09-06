/** LORE_AGENT_INTERNAL_TOKEN (service-to-service) is NOT LORE_INGEST_TOKEN (external/CI) — mixing them 401'd the fleet in the 2026-08-24 cutover; the fallback here is local-dev only, where both ends share one token. */
export function internalToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.LORE_AGENT_INTERNAL_TOKEN || env.LORE_INGEST_TOKEN;
}
