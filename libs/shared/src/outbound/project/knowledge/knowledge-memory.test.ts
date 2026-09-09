import { describe, it, expect } from "vitest";
import { InMemoryKnowledge } from "./knowledge-memory.js";
import type { LiveGraphResult } from "./live-graph.js";

const graphRow = (
  entity: string,
  related: string,
  overrides: Partial<LiveGraphResult> = {},
): LiveGraphResult => ({
  entity,
  entity_type: "service",
  relation: "depends_on",
  related_entity: related,
  related_type: "service",
  direction: "outgoing",
  valid_from: "2026-08-01T00:00:00Z",
  ...overrides,
});

describe("InMemoryKnowledge doc listings", () => {
  it("listSpecs returns distinct sorted .md paths of the repo's spec chunks, title = path", async () => {
    const knowledge = new InMemoryKnowledge({
      docs: [
        { repo: "a/b", path: "specs/z/spec.md", contentType: "spec" },
        { repo: "a/b", path: "specs/a/spec.md", contentType: "spec" },
        { repo: "a/b", path: "specs/a/spec.md", contentType: "spec" },
        { repo: "a/b", path: "specs/raw.txt", contentType: "spec" },
        { repo: "a/b", path: "adrs/ADR-001.md", contentType: "adr" },
        { repo: "other/repo", path: "specs/x/spec.md", contentType: "spec" },
      ],
    });

    expect(await knowledge.listSpecs("a/b")).toEqual([
      { path: "specs/a/spec.md", title: "specs/a/spec.md" },
      { path: "specs/z/spec.md", title: "specs/z/spec.md" },
    ]);
  });

  it("listAdrs filters by the adr content type", async () => {
    const knowledge = new InMemoryKnowledge({
      docs: [
        { repo: "a/b", path: "adrs/ADR-001.md", contentType: "adr" },
        { repo: "a/b", path: "specs/x/spec.md", contentType: "spec" },
      ],
    });

    expect(await knowledge.listAdrs("a/b")).toEqual([
      { path: "adrs/ADR-001.md", title: "adrs/ADR-001.md" },
    ]);
  });
});

describe("InMemoryKnowledge graph + canned reads", () => {
  it("queryLiveGraph without a term returns all seeded rows, with a term matches the entity case-insensitively", async () => {
    const rows = [graphRow("Floor", "Postgres"), graphRow("web-ui", "Floor")];
    const knowledge = new InMemoryKnowledge({ graph: rows });

    expect(await knowledge.queryLiveGraph("a/b")).toEqual(rows);
    expect(await knowledge.queryLiveGraph("a/b", "FLOOR")).toEqual([rows[0]]);
    expect(await knowledge.queryLiveGraph("a/b", "nothing")).toEqual([]);
  });

  it("queryTrace returns the same not-deployed sentence as the Pg stub", async () => {
    expect(await new InMemoryKnowledge().queryTrace("a/b", "q")).toBe(
      "Trace queries are not yet available: the spec-traceability graph projection is not deployed in this build.",
    );
  });

  it("assembleContext returns the seeded context text", async () => {
    const knowledge = new InMemoryKnowledge({ contextText: "seeded context" });

    expect(await knowledge.assembleContext("a/b", "query")).toEqual({
      text: "seeded context",
    });
  });
});
