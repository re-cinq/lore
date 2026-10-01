import { describe, expect, it } from "vitest";
import type {
  TraceDocument,
  TraceStatement,
} from "../../domain/spec-trace/assemble-trace-document.js";
import {
  driftBrief,
  findDrift,
  findUnlinked,
  unlinkedBrief,
  type UpkeepSources,
} from "./findings.js";

function statement(overrides: Partial<TraceStatement>): TraceStatement {
  return {
    uid: "0x1",
    ordinal: 1,
    text: "The cart totals its lines.",
    state: "tested",
    links: [],
    ...overrides,
  };
}

function doc(filePath: string, statements: TraceStatement[]): TraceDocument {
  return {
    filePath,
    title: filePath,
    description: "",
    sections: [{ uid: "s1", heading: "Totals", ordinal: 1 }],
    statements,
    coverage: { testable: 0, covered: 0, untestable: 0, ratio: 0 },
  };
}

function sources(docs: TraceDocument[]): UpkeepSources {
  return {
    specPaths: () => Promise.resolve(docs.map((spec) => spec.filePath)),
    document: (path) =>
      Promise.resolve(docs.find((spec) => spec.filePath === path)!),
  };
}

const VIOLATED = statement({
  ordinal: 3,
  sectionUid: "s1",
  violated: true,
  links: [
    {
      kind: "test",
      label: "totals two lines",
      path: "src/cart.test.ts",
      line: 12,
    },
  ],
});
const UNTESTED = statement({
  ordinal: 4,
  sectionUid: "s1",
  text: "An empty cart totals zero.",
  state: "untested",
});

describe("findDrift", () => {
  it("finds the statement of specs/cart/spec.md whose bound test fails, with its section and the test", async () => {
    const found = await findDrift(
      sources([doc("specs/cart/spec.md", [statement({}), VIOLATED])]),
      3,
    );

    expect(found).toEqual([
      {
        specPath: "specs/cart/spec.md",
        statements: [
          {
            text: "The cart totals its lines.",
            ordinal: 3,
            section: "Totals",
            reason: "violated",
            links: [
              {
                kind: "test",
                label: "totals two lines",
                path: "src/cart.test.ts",
                line: 12,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("finds nothing in a spec whose statements all hold", async () => {
    expect(
      await findDrift(sources([doc("specs/cart/spec.md", [statement({})])]), 3),
    ).toEqual([]);
  });

  it("skips specs/cart/plan.md, a prose artifact that asserts nothing", async () => {
    expect(
      await findDrift(sources([doc("specs/cart/plan.md", [VIOLATED])]), 3),
    ).toEqual([]);
  });

  it("stops at 2 drifted specs when the limit is 2", async () => {
    const drifted = ["a", "b", "c"].map((name) =>
      doc(`specs/${name}/spec.md`, [VIOLATED]),
    );

    const found = await findDrift(sources(drifted), 2);

    expect(found.map((spec) => spec.specPath)).toEqual([
      "specs/a/spec.md",
      "specs/b/spec.md",
    ]);
  });

  it("leaves out a spec the graph cannot be read for and still reads the rest", async () => {
    const reads: UpkeepSources = {
      specPaths: () =>
        Promise.resolve(["specs/broken/spec.md", "specs/cart/spec.md"]),
      document: (path) =>
        path === "specs/broken/spec.md"
          ? Promise.reject(new Error("502"))
          : Promise.resolve(doc(path, [VIOLATED])),
    };

    const found = await findDrift(reads, 3);

    expect(found.map((spec) => spec.specPath)).toEqual(["specs/cart/spec.md"]);
  });
});

describe("when the graph cannot be read at all", () => {
  const down: UpkeepSources = {
    specPaths: () => Promise.resolve(["specs/a/spec.md", "specs/b/spec.md"]),
    document: () => Promise.reject(new Error("502")),
  };

  it("throws from findDrift rather than answer that nothing drifted", async () => {
    await expect(findDrift(down, 3)).rejects.toThrow(
      new Error(
        "none of the 2 spec(s) could be read from the traceability graph",
      ),
    );
  });

  it("throws from findUnlinked rather than answer that nothing is unlinked", async () => {
    await expect(findUnlinked(down, 25)).rejects.toThrow(
      new Error(
        "none of the 2 spec(s) could be read from the traceability graph",
      ),
    );
  });

  it("finds nothing, without throwing, in a repository that lists no spec", async () => {
    expect(await findDrift(sources([]), 3)).toEqual([]);
  });
});

describe("findUnlinked", () => {
  it("finds the testable statement of specs/cart/spec.md that no test validates", async () => {
    const found = await findUnlinked(
      sources([doc("specs/cart/spec.md", [statement({}), UNTESTED])]),
      25,
    );

    expect(found).toEqual([
      {
        specPath: "specs/cart/spec.md",
        statements: [
          { text: "An empty cart totals zero.", ordinal: 4, section: "Totals" },
        ],
      },
    ]);
  });

  it("leaves out narrative statements and tested ones", async () => {
    const found = await findUnlinked(
      sources([
        doc("specs/cart/spec.md", [
          statement({}),
          statement({ ordinal: 2, state: "narrative" }),
        ]),
      ]),
      25,
    );

    expect(found).toEqual([]);
  });

  it("stops at 3 statements across specs when the limit is 3", async () => {
    const two = [UNTESTED, { ...UNTESTED, ordinal: 5 }];
    const found = await findUnlinked(
      sources([doc("specs/a/spec.md", two), doc("specs/b/spec.md", two)]),
      3,
    );

    expect(found.map((spec) => spec.statements.length)).toEqual([2, 1]);
  });
});

describe("the briefs", () => {
  it("writes the drift brief with the spec, the statement, why it drifted and the test bound to it", async () => {
    const found = await findDrift(
      sources([doc("specs/cart/spec.md", [VIOLATED])]),
      3,
    );

    expect(driftBrief(found)).toBe(
      [
        "# Drifted statements",
        "",
        "## specs/cart/spec.md",
        "",
        "- Statement 3 (Totals): The cart totals its lines.",
        "  - Why: a test bound to this statement fails",
        "  - Test: src/cart.test.ts:12 (totals two lines)",
        "",
      ].join("\n"),
    );
  });

  it("writes the unlinked brief with the spec and each statement to find a test for", async () => {
    const found = await findUnlinked(
      sources([doc("specs/cart/spec.md", [UNTESTED])]),
      25,
    );

    expect(unlinkedBrief(found)).toBe(
      [
        "# Statements with no test link",
        "",
        "## specs/cart/spec.md",
        "",
        "- Statement 4 (Totals): An empty cart totals zero.",
        "",
      ].join("\n"),
    );
  });

  it("says a statement drifted from the code when the projection flagged it and no test fails", async () => {
    const drifted = statement({ ordinal: 2, drifted: true });
    const found = await findDrift(
      sources([doc("specs/cart/spec.md", [drifted])]),
      3,
    );

    expect(driftBrief(found)).toContain(
      "  - Why: the projection flagged this statement as drifted from the code",
    );
  });
});
