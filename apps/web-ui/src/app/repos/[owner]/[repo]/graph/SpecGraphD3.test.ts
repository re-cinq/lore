import { describe, it, expect } from "vitest";
import { computeRing, nodeLinks } from "./SpecGraphD3";
import type { SpecGraphNode, SpecRing } from "@/lib/spec-graph";

describe("computeRing", () => {
  it("lays out one section arc and one statement arc per section", () => {
    const ring: SpecRing = {
      sections: [{ uid: "s1", heading: "Overview", total: 1, tested: 1 }],
      statements: [
        { uid: "st1", sectionUid: "s1", tested: true, text: "It works." },
      ],
    };

    const result = computeRing("specs/a/spec.md", ring);

    expect(result.specPath).toBe("specs/a/spec.md");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      uid: "s1",
      heading: "Overview",
      total: 1,
      tested: 1,
    });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toMatchObject({
      uid: "st1",
      tested: true,
      text: "It works.",
    });
  });

  it("groups multiple statements under their own section", () => {
    const ring: SpecRing = {
      sections: [
        { uid: "s1", heading: "Overview", total: 2, tested: 1 },
        { uid: "s2", heading: "Edge cases", total: 1, tested: 0 },
      ],
      statements: [
        { uid: "st1", sectionUid: "s1", tested: true, text: "First." },
        { uid: "st2", sectionUid: "s1", tested: false, text: "Second." },
        { uid: "st3", sectionUid: "s2", tested: false, text: "Third." },
      ],
    };

    const result = computeRing("specs/a/spec.md", ring);

    expect(result.statements.map((s) => s.uid)).toEqual(["st1", "st2", "st3"]);
  });

  it("skips a section with no statements", () => {
    const ring: SpecRing = {
      sections: [
        { uid: "s1", heading: "Overview", total: 0, tested: 0 },
        { uid: "s2", heading: "Edge cases", total: 1, tested: 1 },
      ],
      statements: [
        { uid: "st1", sectionUid: "s2", tested: true, text: "Only one." },
      ],
    };

    const result = computeRing("specs/a/spec.md", ring);

    expect(result.statements.map((s) => s.uid)).toEqual(["st1"]);
  });

  it("returns no statement arcs for an empty ring", () => {
    const ring: SpecRing = { sections: [], statements: [] };

    const result = computeRing("specs/a/spec.md", ring);

    expect(result.sections).toEqual([]);
    expect(result.statements).toEqual([]);
  });
});

describe("nodeLinks", () => {
  const node = (over: Partial<SpecGraphNode> = {}): SpecGraphNode => ({
    id: "n1",
    type: "Spec",
    label: "spec.md",
    ...over,
  });

  it("links a spec-family node to both its Lore page and GitHub blob", () => {
    const links = nodeLinks(
      node({ type: "Statement", path: "specs/a/spec.md" }),
      "o/r",
    );

    expect(links).toEqual([
      {
        label: "Open in Lore",
        href: "/specs/specs%2Fa%2Fspec.md",
        external: false,
      },
      {
        label: "View on GitHub",
        href: "https://github.com/o/r/blob/HEAD/specs/a/spec.md",
        external: true,
      },
    ]);
  });

  it("appends a line fragment to the GitHub link when the node carries one", () => {
    const links = nodeLinks(
      node({ type: "CodeChunk", path: "src/foo.ts", line: 42 }),
      "o/r",
    );

    expect(links).toContainEqual({
      label: "View on GitHub",
      href: "https://github.com/o/r/blob/HEAD/src/foo.ts#L42",
      external: true,
    });
  });

  it("omits the Lore link for a non-spec-family node", () => {
    const links = nodeLinks(
      node({ type: "CodeChunk", path: "src/foo.ts" }),
      "o/r",
    );

    expect(links.map((l) => l.label)).toEqual(["View on GitHub"]);
  });

  it("returns no links for a node with no path", () => {
    expect(nodeLinks(node({ type: "Feature" }), "o/r")).toEqual([]);
  });
});
