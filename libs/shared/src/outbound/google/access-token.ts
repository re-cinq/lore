// The Google identity a process runs under: its access token and its project, from the GKE metadata server first and the environment otherwise. Shared by every Google adapter (Vertex embeddings, Vertex models) so the lookup has one home.

const METADATA = "http://metadata.google.internal/computeMetadata/v1";
const METADATA_INIT = { headers: { "Metadata-Flavor": "Google" } };

export interface GoogleCredentials {
  /** Empty when the process has no Google identity. */
  token: string;
  /** Empty when no project can be named. */
  project: string;
}

// Resolved at call time (env, then GKE metadata server) — resolving once at module load left it "" in agent/CronJob pods, producing a malformed URL instead of degrading to null.
let cachedProject: string | null = null;

export async function googleCredentials(): Promise<GoogleCredentials> {
  const [token, project] = await Promise.all([
    resolveGoogleAccessToken(),
    resolveGoogleProject(),
  ]);

  return { token, project };
}

export async function resolveGoogleAccessToken(): Promise<string> {
  try {
    const res = await fetch(
      `${METADATA}/instance/service-accounts/default/token`,
      { signal: AbortSignal.timeout(30_000), ...METADATA_INIT },
    );
    const { access_token: token } = (await res.json()) as {
      access_token: string;
    };

    return token;
  } catch {
    return process.env.GOOGLE_ACCESS_TOKEN || "";
  }
}

export async function resolveGoogleProject(): Promise<string> {
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
    const res = await fetch(`${METADATA}/project/project-id`, {
      signal: AbortSignal.timeout(30_000),
      ...METADATA_INIT,
    });

    if (!res.ok) {
      return "";
    }

    return (await res.text()).trim();
  } catch {
    return "";
  }
}

/** Reset the process-cached project resolution — for tests. */
export function resetGoogleProjectCache(): void {
  cachedProject = null;
}
