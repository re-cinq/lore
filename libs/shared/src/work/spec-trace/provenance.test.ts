import { describe, it, expect } from "vitest";
import { type ProvenanceRef } from "./deps.js";
import {
  parseValidatesAnnotations,
  resolveProvenance,
  detectProvenanceConflicts,
  type ProvenanceConflict,
} from "./provenance.js";

describe("parseValidatesAnnotations", () => {
  it("returns one ref with numeric ordinal and the file path as target for a single lore:validates line", () => {
    const fileContent = [
      "// lore:validates specs/foo/spec.md#7",
      'export function widget() { return "click"; }',
    ].join("\n");

    const refs = parseValidatesAnnotations(fileContent, "test/x.test.ts");

    const expected: ProvenanceRef[] = [
      { specPath: "specs/foo/spec.md", ordinal: 7, target: "test/x.test.ts" },
    ];

    expect(refs).toEqual(expected);
  });

  it("returns one ref splitting on the ordinal # for a #-comment lore:validates line", () => {
    const fileContent = [
      "# lore:validates specs/foo/spec.md#7",
      "def widget():",
      '    return "click"',
    ].join("\n");

    const refs = parseValidatesAnnotations(fileContent, "api/x_test.py");

    const expected: ProvenanceRef[] = [
      { specPath: "specs/foo/spec.md", ordinal: 7, target: "api/x_test.py" },
    ];

    expect(refs).toEqual(expected);
  });
});

describe("resolveProvenance", () => {
  it("returns one ref when the same triple appears in two sources", () => {
    const ref: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/x.test.ts",
    };

    const resolved = resolveProvenance({ inline: [ref], annotation: [ref] });

    expect(resolved).toEqual([ref]);
  });

  it("keeps only the annotation ref when annotation and inline conflict on the same specPath and ordinal", () => {
    const annotationRef: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/from-annotation.test.ts",
    };
    const inlineRef: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/from-inline.test.ts",
    };

    const resolved = resolveProvenance({
      inline: [inlineRef],
      annotation: [annotationRef],
    });

    expect(resolved).toEqual([annotationRef]);
  });
});

describe("detectProvenanceConflicts", () => {
  it("returns one conflict listing both distinct targets in inline-then-annotation order when inline and annotation disagree on the same specPath and ordinal", () => {
    const inlineRef: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/from-inline.test.ts",
    };
    const annotationRef: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/from-annotation.test.ts",
    };

    const conflicts = detectProvenanceConflicts({
      inline: [inlineRef],
      annotation: [annotationRef],
    });

    const expected: ProvenanceConflict[] = [
      {
        specPath: "specs/foo/spec.md",
        ordinal: 7,
        targets: ["test/from-inline.test.ts", "test/from-annotation.test.ts"],
      },
    ];

    expect(conflicts).toEqual(expected);
  });

  it("returns no conflict when the same triple appears in two sources with identical target", () => {
    const ref: ProvenanceRef = {
      specPath: "specs/foo/spec.md",
      ordinal: 7,
      target: "test/x.test.ts",
    };

    expect(
      detectProvenanceConflicts({ inline: [ref], annotation: [ref] }),
    ).toEqual([]);
  });
});
