// Langfuse tracing wrapper for MCP search calls

interface TraceParams {
  namespace: string;
  query: string;
  topScore: number;
  resultCount: number;
}

const LANGFUSE_PK = process.env.LANGFUSE_PK;
const LANGFUSE_SK = process.env.LANGFUSE_SK;
const LANGFUSE_HOST = process.env.LANGFUSE_HOST;
const LOW_CONFIDENCE_THRESHOLD = 0.72;

/** The trace one search produces. A top score under the threshold marks the query as a documentation gap — that tag is the whole reason this call exists. */
function searchTrace(params: TraceParams): object {
  const isLowConfidence = params.topScore < LOW_CONFIDENCE_THRESHOLD;

  return {
    name: "context-retrieval",
    metadata: {
      namespace: params.namespace,
      query: params.query,
      topScore: params.topScore,
      resultCount: params.resultCount,
      ...(isLowConfidence && { gap_candidate: true }),
    },
    tags: isLowConfidence ? ["low-confidence"] : [],
  };
}

export async function tracedSearch(params: TraceParams): Promise<void> {
  // tracing disabled
  if (!LANGFUSE_PK || !LANGFUSE_SK) {
    return;
  }

  try {
    await fetch(`${LANGFUSE_HOST}/api/public/ingestion`, {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${LANGFUSE_PK}:${LANGFUSE_SK}`).toString("base64")}`,
      },
      body: JSON.stringify({
        batch: [
          {
            type: "trace-create",
            body: searchTrace(params),
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    // Tracing failures must never block search
  }
}
