/** Resolves the active {@link EmbeddingProvider} from env: `LORE_EMBEDDING_PROVIDER`, defaulting to Vertex. */

import { enforceTrue } from "../../lib/enforce.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { VertexEmbeddingProvider } from "./vertex-embedding-provider.js";

const PROVIDER_FACTORIES = new Map<string, () => EmbeddingProvider>([
  ["vertex", () => new VertexEmbeddingProvider()],
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

  return factory();
}
