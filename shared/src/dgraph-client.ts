/**
 * The single runtime seam that constructs a live `dgraph-js-http` client,
 * env-gated on `LORE_DGRAPH_HTTP`. Everything else in the codebase takes an
 * injected `DgraphClientPort` so it stays testable without a real backend.
 * `DgraphClientStub` is lazy — no network call happens on construction.
 */
import * as dgraph from "dgraph-js-http";
import type { DgraphClientPort } from "./memory-store.js";

export function createDgraphClient(
  env: NodeJS.ProcessEnv = process.env,
): DgraphClientPort | null {
  const httpUrl = env.LORE_DGRAPH_HTTP;
  if (!httpUrl) return null;
  return new dgraph.DgraphClient(new dgraph.DgraphClientStub(httpUrl));
}
