// Gemini models served by Vertex AI: the same generateContent body as the Gemini API, on the project's regional endpoint, authenticated by the Google identity the process runs under instead of an API key.

import { enforceTrue } from "../../lib/enforce.js";
import {
  googleCredentials,
  type GoogleCredentials,
} from "../google/access-token.js";
import type { UsagePort } from "../project/usage/usage-port.js";
import { GeminiProvider, type GenerateEndpoint } from "./gemini-provider.js";

const DEFAULT_REGION = "europe-west1";

export interface VertexProviderOptions {
  model?: string;
  region?: string;
  usage?: UsagePort;
  fetchFn?: typeof fetch;
  /** The identity to call as; the process's own unless a test hands one in. */
  credentials?: () => Promise<GoogleCredentials>;
}

export class VertexProvider extends GeminiProvider {
  constructor(opts: VertexProviderOptions = {}) {
    super({
      model: opts.model,
      usage: opts.usage,
      fetchFn: opts.fetchFn,
      vendor: "vertex",
      endpoint: vertexEndpoint(opts),
    });
  }
}

function vertexEndpoint(opts: VertexProviderOptions): GenerateEndpoint {
  const region = opts.region || process.env.GCP_REGION || DEFAULT_REGION;
  const credentials = opts.credentials ?? googleCredentials;

  return async (model) => {
    const { token, project } = signedIn(await credentials());

    return {
      url: `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:generateContent`,
      headers: { Authorization: `Bearer ${token}` },
    };
  };
}

function signedIn(credentials: GoogleCredentials): GoogleCredentials {
  enforceTrue(
    credentials.token,
    Error,
    "Vertex needs a Google access token: run under a workload identity or set GOOGLE_ACCESS_TOKEN",
  );
  enforceTrue(
    credentials.project,
    Error,
    "Vertex needs a Google project: set GCP_PROJECT or run on GKE",
  );

  return credentials;
}
