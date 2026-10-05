// Vertex AI text-embedding-005 via plain fetch (we run CNPG, not managed AlloyDB, so no embedding() function); degrades to null when no credential/project is available so callers fall back to keyword-only search.

import {
  resolveGoogleAccessToken,
  resolveGoogleProject,
} from "../google/access-token.js";
import { recordEmbeddingOutcome } from "./embedding-health.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

const VERTEX_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

/** Vertex's per-request ceilings for text-embedding-005: 250 instances and 20k tokens. Chars stand in for tokens at a conservative 50k (~12.5k tokens), since each text is already capped at 8000 chars. */
const MAX_BATCH_TEXTS = 250;
const MAX_BATCH_CHARS = 50_000;
const MAX_TEXT_CHARS = 8000;

export class VertexEmbeddingProvider implements EmbeddingProvider {
  readonly vendor = "vertex";
  readonly model = VERTEX_MODEL;
  readonly dimensions = 768;

  /** Resolves the Vertex credential and project, then embeds batch by batch; nulls throughout when either is missing. */
  async embed(texts: string[]): Promise<Array<number[] | null>> {
    const token = await resolveGoogleAccessToken();
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
}

async function resolveProjectOrWarn(): Promise<string> {
  const project = await resolveGoogleProject();

  if (!project) {
    console.error(
      "[embeddings] No GCP project resolved for Vertex AI (set GCP_PROJECT or run on GKE)",
    );
  }

  return project;
}

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

async function readEmbeddingValues(res: Response): Promise<number[][]> {
  const json = (await res.json()) as {
    predictions: Array<{ embeddings: { values: number[] } }>;
  };

  return json.predictions.map((prediction) => prediction.embeddings.values);
}
