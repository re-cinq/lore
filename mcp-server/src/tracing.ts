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

export async function tracedSearch(params: TraceParams): Promise<void> {
  if (!LANGFUSE_PK || !LANGFUSE_SK) return; // tracing disabled

  const isLowConfidence = params.topScore < LOW_CONFIDENCE_THRESHOLD;

  const metadata: Record<string, unknown> = {
    namespace: params.namespace,
    query: params.query,
    topScore: params.topScore,
    resultCount: params.resultCount,
    ...(isLowConfidence && { gap_candidate: true }),
  };

  const trace = {
    name: "context-retrieval",
    metadata,
    tags: isLowConfidence ? ["low-confidence"] : [],
  };

  try {
    await fetch(`${LANGFUSE_HOST}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${LANGFUSE_PK}:${LANGFUSE_SK}`).toString("base64")}`,
      },
      body: JSON.stringify({
        batch: [
          {
            type: "trace-create",
            body: trace,
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
