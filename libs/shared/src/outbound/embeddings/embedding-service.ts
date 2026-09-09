// Vertex AI text-embedding-005 via plain fetch (we run CNPG, not managed AlloyDB, so no embedding() function); degrades to null when no credential/project is available so callers fall back to keyword-only search.

const VERTEX_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

/** What the embedder has been answering lately. The 403 outage of 2026-08-13 → 09-09 was visible only as a log line nobody grepped; this is the same fact as a value /healthz, the assembled bundle and lore-doctor can read. */
export interface EmbeddingHealth {
  lastOkAt: string | null;
  lastFailureAt: string | null;
  /** HTTP status of the last refused call; null when no call could be made (no credential, no project, network). */
  lastStatus: number | null;
  consecutiveFailures: number;
}

export type EmbeddingOutcome =
  { ok: true } | { ok: false; status: number | null };

/** Three in a row separates an outage from one transient refusal. */
export const EMBEDDER_DEGRADED_AFTER = 3;

const HEALTHY: EmbeddingHealth = {
  lastOkAt: null,
  lastFailureAt: null,
  lastStatus: null,
  consecutiveFailures: 0,
};

let health: EmbeddingHealth = { ...HEALTHY };

export function embeddingHealth(): EmbeddingHealth {
  return { ...health };
}

export function embedderDegraded(
  current: EmbeddingHealth = embeddingHealth(),
): boolean {
  return current.consecutiveFailures >= EMBEDDER_DEGRADED_AFTER;
}

export function recordEmbeddingOutcome(outcome: EmbeddingOutcome): void {
  const at = new Date().toISOString();

  health = outcome.ok
    ? { ...health, lastOkAt: at, consecutiveFailures: 0 }
    : {
        ...health,
        lastFailureAt: at,
        lastStatus: outcome.status,
        consecutiveFailures: health.consecutiveFailures + 1,
      };
}

export function resetEmbeddingHealth(): void {
  health = { ...HEALTHY };
}

export function buildVertexUrl(project: string, region: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${VERTEX_MODEL}:predict`;
}

// Resolved at call time (env, then GKE metadata server) — resolving once at module load left it "" in agent/CronJob pods, producing a malformed URL instead of degrading to null.
let cachedProject: string | null = null;

function fromEnvProject(): string {
  return process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
}

async function fetchMetadataProject(): Promise<string> {
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/project/project-id",
      {
        signal: AbortSignal.timeout(30_000),
        headers: { "Metadata-Flavor": "Google" },
      },
    );

    if (!res.ok) {
      return "";
    }

    return (await res.text()).trim();
  } catch {
    return "";
  }
}

export async function resolveVertexProject(): Promise<string> {
  if (cachedProject !== null) {
    return cachedProject;
  }
  const fromEnv = fromEnvProject();

  if (fromEnv) {
    return (cachedProject = fromEnv);
  }

  return (cachedProject = await fetchMetadataProject());
}

/** Reset the process-cached project resolution — for tests. */
export function resetVertexProjectCache(): void {
  cachedProject = null;
}

async function resolveAccessToken(): Promise<string> {
  try {
    const metaRes = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        signal: AbortSignal.timeout(30_000),
        headers: { "Metadata-Flavor": "Google" },
      },
    );
    const metaJson = (await metaRes.json()) as { access_token: string };

    return metaJson.access_token;
  } catch {
    return process.env.GOOGLE_ACCESS_TOKEN || "";
  }
}

async function fetchVertexEmbedding(
  project: string,
  token: string,
  query: string,
): Promise<number[] | null> {
  const res = await fetch(buildVertexUrl(project, VERTEX_REGION), {
    signal: AbortSignal.timeout(30_000),
    ...embeddingRequestInit(token, query),
  });

  if (!res.ok) {
    console.error(`[embeddings] Vertex AI embedding failed: ${res.status}`);
    recordEmbeddingOutcome({ ok: false, status: res.status });

    return null;
  }
  const values = await readEmbeddingValues(res);

  recordEmbeddingOutcome({ ok: true });

  return values;
}

function embeddingRequestInit(token: string, query: string): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ content: query.substring(0, 8000) }],
    }),
  };
}

async function readEmbeddingValues(res: Response): Promise<number[]> {
  const json = (await res.json()) as {
    predictions: Array<{ embeddings: { values: number[] } }>;
  };

  const [prediction] = json.predictions;

  return prediction.embeddings.values;
}

export async function getQueryEmbedding(
  query: string,
): Promise<number[] | null> {
  try {
    const token = await resolveAccessToken();
    const project = token ? await resolveProjectOrWarn() : "";

    if (!token || !project) {
      recordEmbeddingOutcome({ ok: false, status: null });

      return null;
    }

    return await fetchVertexEmbedding(project, token, query);
  } catch (err) {
    console.error("[embeddings] Vertex AI embedding error:", err);
    recordEmbeddingOutcome({ ok: false, status: null });

    return null;
  }
}

async function resolveProjectOrWarn(): Promise<string> {
  const project = await resolveVertexProject();

  if (!project) {
    console.error(
      "[embeddings] No GCP project resolved for Vertex AI (set GCP_PROJECT or run on GKE)",
    );
  }

  return project;
}
