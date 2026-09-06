/** The single runtime seam constructing a live `dgraph-js-http` client (env-gated on `LORE_DGRAPH_HTTP`); everything else takes an injected `DgraphClientPort`. */
import * as dgraph from "dgraph-js-http";
import type { DgraphClientPort } from "./memory-store.js";

export function createDgraphClient(
  env: NodeJS.ProcessEnv = process.env,
): DgraphClientPort | null {
  const httpUrl = env.LORE_DGRAPH_HTTP;

  if (!httpUrl) {
    return null;
  }

  return new dgraph.DgraphClient(new dgraph.DgraphClientStub(httpUrl));
}
