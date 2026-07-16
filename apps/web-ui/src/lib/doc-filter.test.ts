import { describe, it, expect } from "vitest";
import { filterDocCards, sortDocCards } from "./doc-filter";
import type { SpecStatus } from "./spec-status";

interface Doc {
  path: string;
  status?: SpecStatus;
}

const shipped: SpecStatus = "shipped";
const draft: SpecStatus = "draft";

const docs: Doc[] = [
  { path: "specs/alpha/spec.md", status: shipped },
  { path: "specs/beta/spec.md", status: draft },
  { path: "specs/gamma/spec.md" },
];

const statusOf = (doc: Doc) => doc.status;
const textOf = (doc: Doc) => doc.path;

describe("filterDocCards", () => {
  it("counts statused items and keeps everything visible on all", () => {
    expect(filterDocCards(docs, statusOf, "all")).toEqual({
      counts: { shipped: 1, draft: 1 },
      visible: docs,
    });
  });

  it("narrows visible to the selected status, keeping input order", () => {
    expect(filterDocCards(docs, statusOf, "draft").visible).toEqual([docs[1]]);
  });

  it("hides unstatused items under a status filter", () => {
    expect(filterDocCards(docs, statusOf, "shipped").visible).toEqual([
      docs[0],
    ]);
  });

  it("matches the query case-insensitively and recounts within the match", () => {
    const result = filterDocCards(docs, statusOf, "all", "BETA", textOf);

    expect(result).toEqual({ counts: { draft: 1 }, visible: [docs[1]] });
  });

  it("combines query and status filter", () => {
    expect(
      filterDocCards(docs, statusOf, "shipped", "spec.md", textOf).visible,
    ).toEqual([docs[0]]);
    expect(
      filterDocCards(docs, statusOf, "draft", "alpha", textOf).visible,
    ).toEqual([]);
  });

  it("ignores a whitespace-only query", () => {
    expect(filterDocCards(docs, statusOf, "all", "  ", textOf).visible).toEqual(
      docs,
    );
  });
});

describe("sortDocCards", () => {
  it("returns the input order for the path order", () => {
    expect(sortDocCards(docs, "path", statusOf)).toEqual(docs);
  });

  it("orders by status lifecycle with unstatused last, stable within", () => {
    const extra: Doc[] = [
      { path: "specs/a/spec.md", status: shipped },
      { path: "specs/b/spec.md" },
      { path: "specs/c/spec.md", status: draft },
      { path: "specs/d/spec.md", status: shipped },
    ];

    expect(sortDocCards(extra, "status", statusOf).map((d) => d.path)).toEqual([
      "specs/c/spec.md",
      "specs/a/spec.md",
      "specs/d/spec.md",
      "specs/b/spec.md",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...docs];

    sortDocCards(input, "status", statusOf);
    expect(input).toEqual(docs);
  });
});
