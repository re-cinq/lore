import { describe, it, expect } from "vitest";
import type { TaggedRunResult, TestDescriptor } from "../../test-report.js";
import { statementItems } from "../docs/doc-statements.js";
import {
  attribute,
  fitsOneItem,
  relation,
  type StatementItem,
} from "../statements.js";
import { testReportItems } from "./test-report-statements.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BLOB = "https://github.com/re-cinq/lore/blob/HEAD";
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
  testReportItems({ repo: "re-cinq/lore", tests, results });

const passing = (
  covered: TaggedRunResult["covered"] = [],
): TaggedRunResult[] => [{ id: ROUNDS_TEST.id, passed: true, covered }];

const failing: TaggedRunResult[] = [
  { id: ROUNDS_TEST.id, passed: false, covered: [] },
];

const coveringFiles = (count: number): TaggedRunResult["covered"] =>
  Array.from({ length: count }, (_, index) => ({
    file: `libs/shared/src/module-${index}/module-${index}.ts`,
    startLine: 1,
    endLine: 40,
  }));

const relationsOf = (pushed: StatementItem[], phrase: string) =>
  pushed.flatMap((part) => part.s.filter((row) => row[2] === phrase));

describe("testReportItems", () => {
  it("returns one item test:src/a.test.ts#1e7912b3 per test with the file head, contains, title, known_as, path, line_start, line_end, anchor_hash, permalink and outcome", () => {
    const pushed = build(
      [
        { ...ROUNDS_TEST, spec: undefined, anchorHash: "1e7912b3" },
        {
          id: "t2",
          name: "stops twice",
          file: "src/a.test.ts",
          startLine: 12,
          anchorHash: "359f8b28",
        },
      ],
      [
        { id: ROUNDS_TEST.id, passed: true, covered: [] },
        { id: "t2", passed: false, covered: [] },
      ],
    );
    const stops = "re-cinq/lore:src/a.test.ts::stops twice";
    const head = [
      ["re-cinq/lore", "Repository", true],
      [FILE, "SourceFile", true],
    ];
    const fileRows = [
      relation("re-cinq/lore", "contains", FILE),
      attribute(FILE, "path", "src/a.test.ts"),
      attribute(FILE, "known_as", "a.test.ts"),
      attribute(FILE, "known_as", "src/a.test.ts"),
    ];

    expect(pushed).toEqual([
      {
        externalId: "test:src/a.test.ts#1e7912b3",
        e: [...head, [ROUNDS, "Test", true]],
        s: [
          ...fileRows,
          relation(FILE, "contains", ROUNDS),
          attribute(ROUNDS, "title", "counts rounds"),
          attribute(ROUNDS, "known_as", "counts rounds"),
          attribute(ROUNDS, "path", "src/a.test.ts"),
          attribute(ROUNDS, "anchor_hash", "1e7912b3"),
          attribute(ROUNDS, "line_start", "4"),
          attribute(ROUNDS, "line_end", "9"),
          attribute(ROUNDS, "permalink", `${BLOB}/src/a.test.ts#L4-L9`),
          attribute(ROUNDS, "outcome", "passed"),
        ],
      },
      {
        externalId: "test:src/a.test.ts#359f8b28",
        e: [...head, [stops, "Test", true]],
        s: [
          ...fileRows,
          relation(FILE, "contains", stops),
          attribute(stops, "title", "stops twice"),
          attribute(stops, "known_as", "stops twice"),
          attribute(stops, "path", "src/a.test.ts"),
          attribute(stops, "anchor_hash", "359f8b28"),
          attribute(stops, "line_start", "12"),
          attribute(stops, "permalink", `${BLOB}/src/a.test.ts#L12`),
          attribute(stops, "outcome", "failed"),
        ],
      },
    ]);
  });

  it("covers each file once as one relation qualified by its merged lines and adds no path or known_as rows for the covered file", () => {
    const pushed = build(
      [ROUNDS_TEST],
      passing([
        { file: "src/a.ts", startLine: 6, endLine: 9 },
        { file: "src/a.ts", startLine: 3, endLine: 5 },
      ]),
    );
    const source = "re-cinq/lore:src/a.ts";

    expect({
      covers: relationsOf(pushed, "covers"),
      rows: pushed[0].s.filter((row) => row[1] === source),
      entity: pushed[0].e.filter(([name]) => name === source),
    }).toEqual({
      covers: [relation(ROUNDS, "covers", source, { lines: "3-9" })],
      rows: [],
      entity: [[source, "SourceFile", true]],
    });
  });

  it("splits a test covering 400 files into #hash, #hash.2 and #hash.3, each repeating the test and its outcome and each within the push limits", () => {
    const pushed = build([ROUNDS_TEST], passing(coveringFiles(400)));

    expect({
      ids: pushed.map((part) => part.externalId),
      fits: pushed.map(fitsOneItem),
      tests: pushed.map((part) => part.e.filter(([name]) => name === ROUNDS)),
      outcomes: pushed.map((part) => relationsOf([part], "outcome")),
      covers: relationsOf(pushed, "covers").length,
    }).toEqual({
      ids: [
        "test:src/a.test.ts#483b3bb1",
        "test:src/a.test.ts#483b3bb1.2",
        "test:src/a.test.ts#483b3bb1.3",
      ],
      fits: [true, true, true],
      tests: pushed.map(() => [[ROUNDS, "Test", true]]),
      outcomes: pushed.map(() => [attribute(ROUNDS, "outcome", "passed")]),
      covers: 400,
    });
  });

  it("returns known_as counts rounds for the test and a.test.ts and src/a.test.ts for its file", () => {
    const pushed = build([{ ...ROUNDS_TEST, spec: undefined }]);

    expect(relationsOf(pushed, "known_as")).toEqual([
      attribute(FILE, "known_as", "a.test.ts"),
      attribute(FILE, "known_as", "src/a.test.ts"),
      attribute(ROUNDS, "known_as", "counts rounds"),
    ]);
  });

  it("returns anchor_hash a3f9c1d2 for a test whose descriptor carries it, and none for one that does not", () => {
    const hashed = build([{ ...ROUNDS_TEST, anchorHash: "a3f9c1d2" }]);
    const plain = build([ROUNDS_TEST]);

    expect([
      relationsOf(hashed, "anchor_hash"),
      relationsOf(plain, "anchor_hash"),
    ]).toEqual([[attribute(ROUNDS, "anchor_hash", "a3f9c1d2")], []]);
  });

  it("names a test with no anchorHash by the hash of its title", () => {
    const pushed = build([ROUNDS_TEST]);

    expect({
      ids: pushed.map((part) => part.externalId),
      anchorHashes: relationsOf(pushed, "anchor_hash"),
    }).toEqual({ ids: ["test:src/a.test.ts#483b3bb1"], anchorHashes: [] });
  });

  it("names a test whose title is too short to hash by its first line", () => {
    const pushed = build([
      { id: "t2", name: "stops", file: "src/a.test.ts", startLine: 12 },
    ]);

    expect(pushed.map((part) => part.externalId)).toEqual([
      "test:src/a.test.ts#l12",
    ]);
  });

  it("merges two descriptors sharing one anchor hash into one item that is known as both titles and is failed when either failed", () => {
    const rows = ["row 1 of 2", "row 2 of 2"].map((row) => ({
      ...ROUNDS_TEST,
      id: `src/a.test.ts::${row}`,
      name: row,
      anchorHash: "a3f9c1d2",
      spec: undefined,
    }));
    const pushed = build(rows, [
      { id: rows[0].id, passed: true, covered: [] },
      { id: rows[1].id, passed: false, covered: [] },
    ]);
    const test = "re-cinq/lore:src/a.test.ts::row 1 of 2";

    expect({
      ids: pushed.map((part) => part.externalId),
      tests: pushed[0].e.filter(([, kind]) => kind === "Test"),
      titles: relationsOf(pushed, "title"),
      knownAs: relationsOf(pushed, "known_as").filter((row) => row[1] === test),
      outcome: relationsOf(pushed, "outcome"),
    }).toEqual({
      ids: ["test:src/a.test.ts#a3f9c1d2"],
      tests: [[test, "Test", true]],
      titles: [attribute(test, "title", "row 1 of 2")],
      knownAs: [
        attribute(test, "known_as", "row 1 of 2"),
        attribute(test, "known_as", "row 2 of 2"),
      ],
      outcome: [attribute(test, "outcome", "failed")],
    });
  });

  it("pushes a test with no result with neither outcome nor validated_by", () => {
    const pushed = build([ROUNDS_TEST]);

    expect(
      ["outcome", "validated_by", "violated_by"].flatMap((phrase) =>
        relationsOf(pushed, phrase),
      ),
    ).toEqual([]);
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
      validated: relationsOf(pushed, "validated_by"),
      violated: relationsOf(pushed, "violated_by"),
    }).toEqual({
      validated: [],
      violated: [relation(STATEMENT, "violated_by", ROUNDS)],
    });
  });

  it("returns one title and permalink for counts rounds when two describe blocks name a test counts rounds", () => {
    const pushed = build(
      ["specs", "adrs"].map((suite) => ({
        ...ROUNDS_TEST,
        id: `src/a.test.ts::${suite} > counts rounds`,
        name: `${suite} > counts rounds`,
        suite: [suite],
        spec: undefined,
      })),
    );

    expect({
      ids: pushed.map((part) => part.externalId),
      titles: relationsOf(pushed, "title"),
      permalinks: relationsOf(pushed, "permalink"),
    }).toEqual({
      ids: ["test:src/a.test.ts#483b3bb1"],
      titles: [attribute(ROUNDS, "title", "counts rounds")],
      permalinks: [
        attribute(ROUNDS, "permalink", `${BLOB}/src/a.test.ts#L4-L9`),
      ],
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

describe("testReportItems with titles that differ only by case and whitespace", () => {
  it("returns one item and one Test entity known as both titles for two titles that differ only by case and whitespace", () => {
    const shared = { file: "src/a.test.ts", startLine: 4, endLine: 9 };
    const pushed = build([
      { ...shared, id: "src/a.test.ts::upper", name: "types OLT-1" },
      { ...shared, id: "src/a.test.ts::lower", name: "types   olt-1 " },
    ]);
    const test = "re-cinq/lore:src/a.test.ts::types OLT-1";

    expect({
      ids: pushed.map((part) => part.externalId),
      tests: pushed[0].e.filter(([, kind]) => kind === "Test"),
      titles: relationsOf(pushed, "title"),
      knownAs: relationsOf(pushed, "known_as").filter((row) => row[1] === test),
    }).toEqual({
      ids: ["test:src/a.test.ts#7ca40cb1"],
      tests: [[test, "Test", true]],
      titles: [attribute(test, "title", "types OLT-1")],
      knownAs: [
        attribute(test, "known_as", "types OLT-1"),
        attribute(test, "known_as", "types   olt-1 "),
      ],
    });
  });
});
