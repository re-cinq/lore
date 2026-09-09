/** The reporter credential, always preferring the per-agent token once registration completes: a central cluster captures LORE_INGEST_TOKEN at boot and returns it only while the per-agent token is still undefined, and a satellite returns the thunk directly so re-registration rotations are picked up per call. */

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
