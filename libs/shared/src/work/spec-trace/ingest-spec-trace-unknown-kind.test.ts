import { describe, it, expect } from "vitest";
import * as dgraph from "dgraph-js-http";
import { ingestSpecTrace } from "./ingest-spec-trace.js";

describe("ingestSpecTrace (unknown kind)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub("http://localhost:8081"),
  );

  it("rejects with an error naming the kind for an unrecognized kind", async () => {
    await expect(
      ingestSpecTrace(dgraphClient, "re-cinq/lore", "bogus", {}),
    ).rejects.toThrow(/bogus/);
  });
});
