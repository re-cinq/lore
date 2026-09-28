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

export function embedderDegraded(
  current: EmbeddingHealth = embeddingHealth(),
): boolean {
  return current.consecutiveFailures >= EMBEDDER_DEGRADED_AFTER;
}

export function embeddingHealth(): EmbeddingHealth {
  return { ...health };
}

export function resetEmbeddingHealth(): void {
  health = { ...HEALTHY };
}

// Resolved at call time (env, then GKE metadata server) — resolving once at module load left it "" in agent/CronJob pods, producing a malformed URL instead of degrading to null.
let cachedProject: string | null = null;

export async function getQueryEmbedding(
  query: string,
): Promise<number[] | null> {
  const [embedding] = await getQueryEmbeddings([query]);

  return embedding;
}

/** Vertex's per-request ceilings for text-embedding-005: 250 instances and 20k tokens. Chars stand in for tokens at a conservative 50k (~12.5k tokens), since each text is already capped at 8000 chars. */
const MAX_BATCH_TEXTS = 250;
const MAX_BATCH_CHARS = 50_000;
const MAX_TEXT_CHARS = 8000;

/** Groups texts, in order, into the fewest batches Vertex accepts in one predict call. */
export function embeddingBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let batchChars = 0;

  for (const text of texts) {
    const chars = Math.min(text.length, MAX_TEXT_CHARS);
    const current = batches.at(-1);

    if (
      !current ||
      current.length >= MAX_BATCH_TEXTS ||
      batchChars + chars > MAX_BATCH_CHARS
    ) {
      batches.push([text]);
      batchChars = chars;
      continue;
    }
    current.push(text);
    batchChars += chars;
  }

  return batches;
}

/** One vector per text, in input order, from as few Vertex calls as the request ceilings allow; a text whose batch failed gets null. A spec with hundreds of statements embedded one call at a time outran its station's 10-minute deadline (re-cinq/Otto, 2026-09-28). */
export async function getQueryEmbeddings(
  texts: string[],
): Promise<Array<number[] | null>> {
  if (texts.length === 0) {
    return [];
  }

  try {
    return await embedWithCredentials(texts);
  } catch (err) {
    console.error("[embeddings] Vertex AI embedding error:", err);
    recordEmbeddingOutcome({ ok: false, status: null });

    return texts.map(() => null);
  }
}

/** Resolves the Vertex credential and project, then embeds batch by batch; nulls throughout when either is missing. */
async function embedWithCredentials(
  texts: string[],
): Promise<Array<number[] | null>> {
  const token = await resolveAccessToken();
  const project = token ? await resolveProjectOrWarn() : "";

  if (!token || !project) {
    recordEmbeddingOutcome({ ok: false, status: null });

    return texts.map(() => null);
  }
  const vectors: Array<number[] | null> = [];

  for (const batch of embeddingBatches(texts)) {
    vectors.push(...(await fetchVertexEmbeddings(project, token, batch)));
  }

  return vectors;
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

async function resolveProjectOrWarn(): Promise<string> {
  const project = await resolveVertexProject();

  if (!project) {
    console.error(
      "[embeddings] No GCP project resolved for Vertex AI (set GCP_PROJECT or run on GKE)",
    );
  }

  return project;
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

/** Reset the process-cached project resolution — for tests. */
export function resetVertexProjectCache(): void {
  cachedProject = null;
}

async function fetchVertexEmbeddings(
  project: string,
  token: string,
  batch: string[],
): Promise<Array<number[] | null>> {
  const res = await fetch(buildVertexUrl(project, VERTEX_REGION), {
    signal: AbortSignal.timeout(30_000),
    ...embeddingRequestInit(token, batch),
  });

  if (!res.ok) {
    console.error(`[embeddings] Vertex AI embedding failed: ${res.status}`);
    recordEmbeddingOutcome({ ok: false, status: res.status });

    return batch.map(() => null);
  }
  const values = await readEmbeddingValues(res);

  recordEmbeddingOutcome({ ok: true });

  return values;
}

export function buildVertexUrl(project: string, region: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${VERTEX_MODEL}:predict`;
}

function embeddingRequestInit(token: string, batch: string[]): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: batch.map((text) => ({
        content: text.substring(0, MAX_TEXT_CHARS),
      })),
    }),
  };
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

async function readEmbeddingValues(res: Response): Promise<number[][]> {
  const json = (await res.json()) as {
    predictions: Array<{ embeddings: { values: number[] } }>;
  };

  return json.predictions.map((prediction) => prediction.embeddings.values);
}
