import { describe, it, expect } from "vitest";
import { createDgraphClient } from "./dgraph-client.js";

describe("createDgraphClient", () => {
  it("returns a client exposing newTxn when LORE_DGRAPH_HTTP is set", () => {
    const client = createDgraphClient({ LORE_DGRAPH_HTTP: "http://localhost:8081" });
    expect(typeof client?.newTxn).toBe("function");
  });
});
