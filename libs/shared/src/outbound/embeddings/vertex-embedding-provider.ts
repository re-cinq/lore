// Vertex AI text-embedding-005 via plain fetch (we run CNPG, not managed AlloyDB, so no embedding() function); degrades to null when no credential/project is available so callers fall back to keyword-only search.

import {
  resolveGoogleAccessToken,
  resolveGoogleProject,
} from "../google/access-token.js";
import { recordEmbeddingOutcome } from "./embedding-health.js";
import {
  embedBatchwise,
  MAX_EMBEDDING_TEXT_CHARS,
} from "./embedding-batches.js";
import type { EmbeddingProvider } from "./embedding-provider.js";

const VERTEX_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

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

    return embedBatchwise(texts, (batch) =>
      fetchVertexEmbeddings(project, token, batch),
    );
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
        content: text.substring(0, MAX_EMBEDDING_TEXT_CHARS),
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
