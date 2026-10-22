import { describe, it, expect } from "vitest";
import type { TaggedRunResult, TestDescriptor } from "../../test-report.js";
import { statementItems } from "../docs/doc-statements.js";
import {
  attribute,
  fitsOneItem,
  relation,
  type StatementItem,
} from "../statements.js";
import {
  testFileTombstones,
  testReportItems,
} from "./test-report-statements.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BLOB = `https://github.com/re-cinq/lore/blob/${COMMIT}`;
const FILE = "re-cinq/lore:src/a.test.ts";
const ROUNDS = "re-cinq/lore:src/a.test.ts::counts rounds";
const STATEMENT = "re-cinq/lore:specs/a/spec.md#s0002";

const ROUNDS_TEST: TestDescriptor = {
  id: "src/a.test.ts::counts rounds",
  name: "counts rounds",
  file: "src/a.test.ts",
  startLine: 4,
  endLine: 9,
  spec: "specs/a/spec.md#2",
};

const build = (tests: TestDescriptor[], results: TaggedRunResult[] = []) =>
  testReportItems({ repo: "re-cinq/lore", commit: COMMIT, tests, results });

const passing = (
  covered: TaggedRunResult["covered"] = [],
): TaggedRunResult[] => [{ id: ROUNDS_TEST.id, passed: true, covered }];

const failing: TaggedRunResult[] = [
  { id: ROUNDS_TEST.id, passed: false, covered: [] },
];

const relationsOf = (pushed: StatementItem[], phrase: string) =>
  pushed.flatMap((part) => part.s.filter((row) => row[2] === phrase));

describe("testReportItems", () => {
  it("returns one test:src/a.test.ts item holding both its tests with title, path, line_start and permalink at the commit", () => {
    const pushed = build([
      { ...ROUNDS_TEST, spec: undefined },
      { id: "t2", name: "stops", file: "src/a.test.ts", startLine: 12 },
    ]);
    const stops = "re-cinq/lore:src/a.test.ts::stops";

    expect(pushed).toEqual([
      {
        externalId: "test:src/a.test.ts",
        e: [
          ["re-cinq/lore", "Repository", true],
          [FILE, "SourceFile", true],
          [ROUNDS, "Test", true],
          [stops, "Test", true],
        ],
        s: [
          relation("re-cinq/lore", "contains", FILE),
          attribute(FILE, "path", "src/a.test.ts"),
          relation(FILE, "contains", ROUNDS),
          attribute(ROUNDS, "title", "counts rounds"),
          attribute(ROUNDS, "path", "src/a.test.ts"),
          attribute(ROUNDS, "line_start", "4"),
          attribute(ROUNDS, "line_end", "9"),
          attribute(ROUNDS, "commit", COMMIT),
          attribute(ROUNDS, "permalink", `${BLOB}/src/a.test.ts#L4-L9`),
          relation(FILE, "contains", stops),
          attribute(stops, "title", "stops"),
          attribute(stops, "path", "src/a.test.ts"),
          attribute(stops, "line_start", "12"),
          attribute(stops, "commit", COMMIT),
          attribute(stops, "permalink", `${BLOB}/src/a.test.ts#L12`),
        ],
      },
    ]);
  });

  it("returns validated_by for the anchored statement when the anchored test passed", () => {
    const pushed = build([ROUNDS_TEST], passing());

    expect({
      outcome: relationsOf(pushed, "outcome"),
      validated: relationsOf(pushed, "validated_by"),
      violated: relationsOf(pushed, "violated_by"),
      statements: pushed[0].e.filter(([, kind]) => kind === "Statement"),
    }).toEqual({
      outcome: [attribute(ROUNDS, "outcome", "passed")],
      validated: [relation(STATEMENT, "validated_by", ROUNDS)],
      violated: [],
      statements: [[STATEMENT, "Statement", true]],
    });
  });

  it("returns violated_by and outcome failed when the anchored test failed", () => {
    const pushed = build([ROUNDS_TEST], failing);

    expect({
      outcome: relationsOf(pushed, "outcome"),
      validated: relationsOf(pushed, "validated_by"),
      violated: relationsOf(pushed, "violated_by"),
    }).toEqual({
      outcome: [attribute(ROUNDS, "outcome", "failed")],
      validated: [],
      violated: [relation(STATEMENT, "violated_by", ROUNDS)],
    });
  });

  it("returns no outcome relation when the test has no result", () => {
    const pushed = build([ROUNDS_TEST]);

    expect(
      ["outcome", "validated_by", "violated_by"].flatMap((phrase) =>
        relationsOf(pushed, phrase),
      ),
    ).toEqual([]);
  });

  it("returns covers src/a.ts with lines 3-9,12-20 and the commit as qualifiers when ranges are adjacent", () => {
    const pushed = build(
      [ROUNDS_TEST],
      passing([
        { file: "src/a.ts", startLine: 12, endLine: 15 },
        { file: "src/a.ts", startLine: 3, endLine: 5 },
        { file: "src/a.ts", startLine: 6, endLine: 9 },
        { file: "src/a.ts", startLine: 14, endLine: 20 },
      ]),
    );
    const source = "re-cinq/lore:src/a.ts";

    expect({
      covers: relationsOf(pushed, "covers"),
      path: pushed[0].s.filter((row) => row[1] === source),
      entity: pushed[0].e.filter(([name]) => name === source),
    }).toEqual({
      covers: [
        relation(ROUNDS, "covers", source, {
          lines: "3-9,12-20",
          commit: COMMIT,
        }),
      ],
      path: [attribute(source, "path", "src/a.ts")],
      entity: [[source, "SourceFile", true]],
    });
  });

  it("returns no covers when the result's covered is null", () => {
    expect(relationsOf(build([ROUNDS_TEST], passing(null)), "covers")).toEqual(
      [],
    );
  });

  it("returns one relation per anchor when a descriptor names two statements", () => {
    const pushed = build(
      [{ ...ROUNDS_TEST, spec: ["specs/a/spec.md#2", "specs/b/spec.md#11"] }],
      passing(),
    );

    expect(relationsOf(pushed, "validated_by")).toEqual([
      relation(STATEMENT, "validated_by", ROUNDS),
      relation("re-cinq/lore:specs/b/spec.md#s0011", "validated_by", ROUNDS),
    ]);
  });

  it("splits a file with 120 tests into items under 200 statements, the first keeping test:<path>", () => {
    const tests = Array.from({ length: 120 }, (_, i) => ({
      ...ROUNDS_TEST,
      id: `case ${i}`,
      name: `case ${i}`,
    }));
    const pushed = build(
      tests,
      tests.map(({ id }) => ({ id, passed: true, covered: [] })),
    );

    expect({
      ids: pushed.map((part) => part.externalId),
      fits: pushed.map(fitsOneItem),
      heads: pushed.map((part) => part.e.slice(0, 2)),
      tests: pushed.flatMap((part) =>
        part.e.filter(([, kind]) => kind === "Test"),
      ).length,
    }).toEqual({
      ids: [
        "test:src/a.test.ts",
        "test:src/a.test.ts.2",
        "test:src/a.test.ts.3",
        "test:src/a.test.ts.4",
        "test:src/a.test.ts.5",
        "test:src/a.test.ts.6",
        "test:src/a.test.ts.7",
        "test:src/a.test.ts.8",
      ],
      fits: pushed.map(() => true),
      heads: pushed.map(() => [
        ["re-cinq/lore", "Repository", true],
        [FILE, "SourceFile", true],
      ]),
      tests: 120,
    });
  });

  it("names the statement and test exactly as the doc mirror names them", () => {
    const spec = [
      "## Rounds",
      "",
      "- FR1 — Rounds are counted. ([validated by counts rounds](../../src/a.test.ts#L4))",
      "",
    ].join("\n");
    const doc = statementItems({
      repo: "re-cinq/lore",
      path: "specs/a/spec.md",
      content: spec,
      commit: COMMIT,
      kind: "spec",
    });
    const run = build(
      [
        {
          ...ROUNDS_TEST,
          name: "testReportItems > counts rounds",
          suite: ["testReportItems"],
          spec: "specs/a/spec.md#0",
        },
      ],
      passing(),
    );

    expect(relationsOf(run, "validated_by")).toEqual(
      relationsOf(doc, "validated_by"),
    );
  });
});

describe("testFileTombstones", () => {
  it("returns test:<path> tombstones for deleted test files", () => {
    expect(testFileTombstones(["src/a.test.ts", "src/b.test.ts"])).toEqual([
      { externalId: "test:src/a.test.ts", deleted: true },
      { externalId: "test:src/b.test.ts", deleted: true },
    ]);
  });
});
