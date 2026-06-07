import { describe, it, expect } from "vitest";
import { type ProvenanceRef } from "@re-cinq/lore-shared";
import {
  parseValidatesAnnotations,
  resolveProvenance,
  detectProvenanceConflicts,
  type ProvenanceConflict,
} from "../provenance.js";

/**
 * parseValidatesAnnotations (spec-traceability-graph, Phase 2 generation-time
 * provenance capture) — pure parser that lifts `// lore:validates <spec>#<ord>`
 * comment annotations out of a generated code/test file and returns the
 * provenance refs carried by that file. The annotated FILE is the validating
 * target. No Dgraph, no I/O — string in, refs out.
 */
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

/**
 * resolveProvenance (spec-traceability-graph, Phase 2) — merges pre-parsed
 * provenance refs from the three forms (inline `([validated by])` links,
 * `lore:validates` annotations, `Lore-Validates:` trailers) into one list,
 * resolving conflicts by source precedence (annotation > trailer > inline):
 * for each `(specPath, ordinal)` pair the highest-precedence ref wins, so an
 * identical duplicate collapses and a same-pair-different-target loser drops.
 */
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

/**
 * detectProvenanceConflicts (spec-traceability-graph, Phase 2) — surfaces the
 * data-model's "provenance discrepancy" as a value so the caller does the
 * logging. For each `(specPath, ordinal)` pair that drew two or more DISTINCT
 * targets across the sources it returns one `ProvenanceConflict` listing the
 * distinct targets in read order (inline, then annotation, then trailer).
 */
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

    expect(detectProvenanceConflicts({ inline: [ref], annotation: [ref] })).toEqual([]);
  });
});
