import { describe, it, expect } from "vitest";
import * as dgraph from "dgraph-js-http";
import { ingestSpecTrace } from "../ingest-spec-trace.js";

/**
 * ingestSpecTrace dispatcher guard — an unrecognized `kind` must be REJECTED
 * with a clear error, not silently no-oped. The guard throws BEFORE touching
 * Dgraph, so this is a fast unit test: the real client is constructed (lazy, no
 * network) but never reached. No live cluster, no skipIf.
 */

describe("ingestSpecTrace (unknown kind)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub("http://localhost:8081"));

  it("rejects with an error naming the kind for an unrecognized kind", async () => {
    await expect(ingestSpecTrace(dgraphClient, "re-cinq/lore", "bogus", {})).rejects.toThrow(/bogus/);
  });
});
