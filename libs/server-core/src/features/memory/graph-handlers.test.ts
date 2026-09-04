import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freshHandlers(contextPath: string) {
  vi.resetModules();
  process.env.CONTEXT_PATH = contextPath;

  return import("./graph.js");
}

describe("graphSearchHandler", () => {
  let dir: string;
  const origContextPath = process.env.CONTEXT_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graph-search-"));
    mkdirSync(join(dir, "graphrag"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.CONTEXT_PATH = origContextPath;
  });

  it("reports graph not built when graph.json is missing", async () => {
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toContain("GraphRAG hasn't been built");
  });

  it("reports a parse error for invalid JSON", async () => {
    writeFileSync(join(dir, "graphrag", "graph.json"), "not json");
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toBe("Error: failed to parse graph.json.");
  });

  it("reports missing fields when entities or relationships are absent", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({ entities: [] }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toBe(
      'Error: graph.json is missing required "entities" or "relationships" fields.',
    );
  });

  it("reports no matches for an unmatched query", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({
        entities: [{ id: "e1", name: "auth-service", type: "service" }],
        relationships: [],
      }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "nope", depth: 2 });

    expect(result.content[0].text).toBe(
      'No entities found matching "nope". Try a broader search term.',
    );
  });

  it("returns traversal chains for matching entities, singular entity wording", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({
        entities: [
          { id: "e1", name: "auth-service", type: "service" },
          { id: "e2", name: "postgres", type: "technology" },
        ],
        relationships: [{ source: "e1", target: "e2", type: "uses" }],
      }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toContain(
      "Found 1 matching entity, depth=2:",
    );
    expect(result.content[0].text).toContain(
      "service:auth-service → uses:technology:postgres",
    );
  });

  it("falls back to bare seed labels when no traversal chains exist", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({
        entities: [{ id: "e1", name: "auth-service", type: "service" }],
        relationships: [],
      }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toContain("service:auth-service");
  });

  it("uses plural entity wording for multiple matches", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({
        entities: [
          { id: "e1", name: "auth-service", type: "service" },
          { id: "e2", name: "auth-gateway", type: "service" },
        ],
        relationships: [],
      }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toContain(
      "Found 2 matching entities, depth=2:",
    );
  });
});

describe("getDomainSummaryHandler", () => {
  let dir: string;
  const origContextPath = process.env.CONTEXT_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "domain-summary-"));
    mkdirSync(join(dir, "graphrag"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.CONTEXT_PATH = origContextPath;
  });

  it("reports graph not built when communities.json is missing", async () => {
    const { getDomainSummaryHandler } = await freshHandlers(dir);
    const result = await getDomainSummaryHandler({ domain: "payments" });

    expect(result.content[0].text).toContain("GraphRAG hasn't been built");
  });

  it("reports a parse error for invalid JSON", async () => {
    writeFileSync(join(dir, "graphrag", "communities.json"), "not json");
    const { getDomainSummaryHandler } = await freshHandlers(dir);
    const result = await getDomainSummaryHandler({ domain: "payments" });

    expect(result.content[0].text).toBe(
      "Error: failed to parse communities.json.",
    );
  });

  it("reports a shape error when communities.json is not an array", async () => {
    writeFileSync(
      join(dir, "graphrag", "communities.json"),
      JSON.stringify({ domain: "payments" }),
    );
    const { getDomainSummaryHandler } = await freshHandlers(dir);
    const result = await getDomainSummaryHandler({ domain: "payments" });

    expect(result.content[0].text).toBe(
      "Error: communities.json should contain a JSON array of community objects.",
    );
  });

  it("lists available domains when the requested domain is not found", async () => {
    writeFileSync(
      join(dir, "graphrag", "communities.json"),
      JSON.stringify([{ domain: "auth", summary: "Auth domain." }]),
    );
    const { getDomainSummaryHandler } = await freshHandlers(dir);
    const result = await getDomainSummaryHandler({ domain: "payments" });

    expect(result.content[0].text).toBe(
      'No community found for domain "payments". Available domains: auth.',
    );
  });

  it("returns the domain summary for a matching domain, case-insensitively", async () => {
    writeFileSync(
      join(dir, "graphrag", "communities.json"),
      JSON.stringify([{ domain: "Auth", summary: "Auth domain summary." }]),
    );
    const { getDomainSummaryHandler } = await freshHandlers(dir);
    const result = await getDomainSummaryHandler({ domain: "auth" });

    expect(result.content[0].text).toBe(
      "## Domain: Auth\n\nAuth domain summary.",
    );
  });
});

describe("graphSearchHandler error handling", () => {
  let dir: string;
  const origContextPath = process.env.CONTEXT_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graph-search-error-"));
    mkdirSync(join(dir, "graphrag"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.CONTEXT_PATH = origContextPath;
  });

  it("reports the thrown error message when the graph shape breaks traversal", async () => {
    writeFileSync(
      join(dir, "graphrag", "graph.json"),
      JSON.stringify({ entities: "not-an-array", relationships: [] }),
    );
    const { graphSearchHandler } = await freshHandlers(dir);
    const result = await graphSearchHandler({ query: "auth", depth: 2 });

    expect(result.content[0].text).toContain("Error reading graph:");
  });
});
