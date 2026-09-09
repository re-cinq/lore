/**
 * Selects the reporter credential, always preferring the per-agent token once
 * registration has completed.
 *
 * Central cluster (LORE_INGEST_TOKEN present): captures the value at boot as
 * the boot-window fallback. After registration the per-agent token takes over;
 * LORE_INGEST_TOKEN is returned only while getAgentToken() is still undefined.
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
    return () => getAgentToken() ?? ingestToken;
  }

  return getAgentToken;
}
