/** Resolves the active {@link EmbeddingProvider} from env: `LORE_EMBEDDING_PROVIDER`, defaulting to Vertex; `openai` reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `LORE_OPENAI_AUTH_HEADER` and `LORE_EMBEDDING_MODEL`. */

import { enforceTrue } from "../../lib/enforce.js";
import { openAiAuthHeader } from "../openai/openai-auth.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { OpenAiEmbeddingProvider } from "./openai-embedding-provider.js";
import { VertexEmbeddingProvider } from "./vertex-embedding-provider.js";

const PROVIDER_FACTORIES = new Map<
  string,
  (env: NodeJS.ProcessEnv) => EmbeddingProvider
>([
  ["vertex", () => new VertexEmbeddingProvider()],
  [
    "openai",
    (env) =>
      new OpenAiEmbeddingProvider({
        baseUrl: env.OPENAI_BASE_URL,
        apiKey: env.OPENAI_API_KEY,
        authHeader: openAiAuthHeader(env),
        model: env.LORE_EMBEDDING_MODEL,
      }),
  ],
]);

export function selectEmbeddingProvider(
  env: NodeJS.ProcessEnv,
): EmbeddingProvider {
  const name = (env.LORE_EMBEDDING_PROVIDER || "vertex").toLowerCase();
  const factory = PROVIDER_FACTORIES.get(name);

  enforceTrue(
    factory,
    Error,
    `no embedding provider named "${name}"; known: ${[...PROVIDER_FACTORIES.keys()].join(", ")}`,
  );

  return factory(env);
}
