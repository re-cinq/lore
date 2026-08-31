/**
 * Selects the reporter credential once at boot, not per call.
 *
 * Central cluster (LORE_INGEST_TOKEN present): captures the value and returns
 * a static closure so the credential is stable even if the env is mutated.
 *
 * Satellite cluster (LORE_INGEST_TOKEN absent): returns the per-agent token
 * thunk directly, so re-registration rotations are picked up per call.
 */

export function selectReporterToken(
  env: NodeJS.ProcessEnv,
  getAgentToken: () => string | undefined,
): () => string | undefined {
  const ingestToken = env.LORE_INGEST_TOKEN;
  if (ingestToken !== undefined) {
    return () => ingestToken;
  }
  return getAgentToken;
}
