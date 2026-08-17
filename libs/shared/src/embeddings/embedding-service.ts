/**
 * Vertex AI text-embedding-005 embeddings (queries and documents) — a stateless,
 * repo-agnostic shared service (env-configured module singleton, not a Project
 * port). Calls the Vertex predict endpoint over plain fetch (no AlloyDB
 * embedding() function — we run CNPG, not managed AlloyDB) and degrades to null
 * when no credential or project is available, so callers fall back to
 * keyword-only search.
 */

const VERTEX_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

export function buildVertexUrl(project: string, region: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${VERTEX_MODEL}:predict`;
}

// The agent/CronJob env sets no project var, so the project must be resolved at
// call time: env first, then the GKE metadata server (Workload Identity). Reading
// it once at module load (as before) left it "" in those pods, producing a
// malformed `projects//locations` URL + a confusing 400 instead of degrading to
// null. Cached for the process lifetime.
let cachedProject: string | null = null;

export async function resolveVertexProject(): Promise<string> {
  if (cachedProject !== null) {
    return cachedProject;
  }
  const fromEnv =
    process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";

  if (fromEnv) {
    return (cachedProject = fromEnv);
  }

  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/project/project-id",
      { signal: AbortSignal.timeout(30_000), headers: { "Metadata-Flavor": "Google" } },
    );

    if (res.ok) {
      return (cachedProject = (await res.text()).trim());
    }
  } catch {
    // fall through to empty
  }

  return (cachedProject = "");
}

/** Reset the process-cached project resolution — for tests. */
export function resetVertexProjectCache(): void {
  cachedProject = null;
}

export async function getQueryEmbedding(
  query: string,
): Promise<number[] | null> {
  try {
    let token: string;

    try {
      const metaRes = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { signal: AbortSignal.timeout(30_000), headers: { "Metadata-Flavor": "Google" } },
      );
      const metaJson = (await metaRes.json()) as { access_token: string };

      token = metaJson.access_token;
    } catch {
      token = process.env.GOOGLE_ACCESS_TOKEN || "";

      if (!token) {
        return null;
      }
    }

    const project = await resolveVertexProject();

    if (!project) {
      console.error(
        "[embeddings] No GCP project resolved for Vertex AI (set GCP_PROJECT or run on GKE)",
      );

      return null;
    }

    const res = await fetch(buildVertexUrl(project, VERTEX_REGION), { signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ content: query.substring(0, 8000) }],
      }),
    });

    if (!res.ok) {
      console.error(`[embeddings] Vertex AI embedding failed: ${res.status}`);

      return null;
    }

    const json = (await res.json()) as {
      predictions: Array<{ embeddings: { values: number[] } }>;
    };

    return json.predictions[0].embeddings.values;
  } catch (err) {
    console.error("[embeddings] Vertex AI embedding error:", err);

    return null;
  }
}
