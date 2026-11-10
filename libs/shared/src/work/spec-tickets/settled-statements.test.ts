import { describe, expect, it, vi } from "vitest";
import { anchorHashOf } from "../../domain/anchor-hash.js";
import type { StatementAssessment } from "../../domain/feature-planning/decomposition-result.js";
import { evidenceIsPresent } from "../../domain/feature-planning/grounding.js";
import {
  listedLines,
  settledListing,
  settledOn,
  settledStatements,
} from "./settled-statements.js";

const SPEC_PATH = "specs/widget/spec.md";
const RENDERS = "The widget MUST render messages";
const COLOUR = "The widget MUST accept a colour prop";
const BEFORE = spec(`${RENDERS}.`, `${COLOUR}.`);
const RENDERS_TEST = 'it("renders one message per entry", () => {});';
const COLOUR_TEST = 'it("accepts a colour prop", () => {});';
const UNWRITTEN_TEST = 'it("renders nothing", () => {});';
const TESTS = `import { it } from "vitest";\n\n${RENDERS_TEST}\n${COLOUR_TEST}\n`;
const TEST_PATH = "src/widget.test.ts";
const RENDERS_EVIDENCE = {
  path: TEST_PATH,
  start: 3,
  end: 3,
  text: RENDERS_TEST,
};

function spec(...requirements: string[]): string {
  const bullets = requirements.map((requirement) => `- ${requirement}`);

  return [
    "# Widget",
    "An interface.",
    "## Requirements",
    "",
    ...bullets,
    "",
  ].join("\n");
}

function paragraph(...sentences: string[]): string {
  const prose = sentences.join(" ");

  return ["# Widget", "An interface.", "## Requirements", "", prose, ""].join(
    "\n",
  );
}

function cite(line: number, cited?: string): string {
  const label = cited ? `its test @${anchorHashOf(cited)}` : "its test";

  return `[validated by ${label}](../../${TEST_PATH}#L${line})`;
}

function link(line: number, cited?: string): string {
  return `(${cite(line, cited)})`;
}

function verdict(found: Partial<StatementAssessment>): StatementAssessment {
  return {
    file: SPEC_PATH,
    line: 5,
    status: "missing",
    evidence: [],
    ...found,
  };
}

interface Settle {
  spec: string;
  before?: string | null;
  verdicts?: StatementAssessment[];
  files?: Record<string, string>;
}

function citedSpec(spec: string, files?: Record<string, string>) {
  const read = vi.fn(
    async (path: string) => (files ?? { [TEST_PATH]: TESTS })[path] ?? null,
  );

  return { spec, specPath: SPEC_PATH, read };
}

function settle({ spec, before = BEFORE, verdicts = [], files }: Settle) {
  const { read } = citedSpec(spec, files);

  return {
    read,
    settled: settledStatements({
      spec,
      specPath: SPEC_PATH,
      read,
      baseline: { spec: before, statements: verdicts },
    }),
  };
}

describe("settledStatements", () => {
  it("settles a statement the last run planned as it reads now and whose linked test resolves, with the test line as evidence", async () => {
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(3, RENDERS_TEST)}.`, `${COLOUR}.`),
    });

    expect(await settled).toEqual([
      {
        file: SPEC_PATH,
        line: 5,
        status: "present",
        evidence: [RENDERS_EVIDENCE],
      },
    ]);
  });

  it.each([
    { form: "after the sentence's period", cited: `${RENDERS}. ${link(3)}` },
    { form: "before the sentence's period", cited: `${RENDERS} ${link(3)}.` },
    {
      form: "after an issue tag",
      cited: `${RENDERS}. (#16) ${link(3)}`,
      uncited: `${RENDERS}. (#16)`,
    },
  ])(
    "reads a link added $form as no change to the statement",
    async ({ cited, uncited = `${RENDERS}.` }) => {
      const { settled } = settle({ spec: spec(cited), before: spec(uncited) });

      expect(await settled).toMatchObject([{ line: 5, status: "present" }]);
    },
  );

  it("leaves a statement reworded since the last run to the agent, though its old link still resolves", async () => {
    const { settled } = settle({
      spec: spec(`${RENDERS} newest first ${link(3, RENDERS_TEST)}.`),
    });

    expect(await settled).toEqual([]);
  });

  it("leaves a statement the spec states more often than the last run saw to the agent", async () => {
    const cited = `${RENDERS} ${link(3)}.`;
    const { settled } = settle({ spec: spec(cited, cited) });

    expect(await settled).toEqual([]);
  });

  it("leaves a statement moved in from a section the last run did not plan to the agent", async () => {
    const before = `# Widget\n## Background\n\n- ${RENDERS}.\n`;
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(3)}.`),
      before,
    });

    expect(await settled).toEqual([]);
  });

  it("settles nothing when there is no earlier spec to compare with", async () => {
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(3)}.`),
      before: null,
    });

    expect(await settled).toEqual([]);
  });

  it.each([
    {
      found: "partial",
      held: verdict({ status: "partial", evidence: [RENDERS_EVIDENCE] }),
    },
    {
      found: "missing for a stated reason",
      held: verdict({ reason: "The linked test renders a stub." }),
    },
  ])(
    "leaves a statement the last run found $found to the agent",
    async ({ held }) => {
      const { settled } = settle({
        spec: spec(`${RENDERS} ${link(3)}.`),
        verdicts: [held],
      });

      expect(await settled).toEqual([]);
    },
  );

  it("holds a verdict on the statement's text, so it still stands after a merge moved the statement down a line", async () => {
    const moved = spec(`${COLOUR}.`, `${RENDERS} ${link(3)}.`);
    const held = verdict({ status: "partial", evidence: [RENDERS_EVIDENCE] });

    expect(await settle({ spec: moved }).settled).toMatchObject([{ line: 6 }]);
    expect(await settle({ spec: moved, verdicts: [held] }).settled).toEqual([]);
  });

  it.each([
    { verdict: "missing with no reason", found: verdict({}) },
    {
      verdict: "partial in another spec",
      found: verdict({ file: "specs/other/spec.md", status: "partial" }),
    },
  ])(
    "settles a statement linked since the last run found line 5 $verdict",
    async ({ found }) => {
      const { settled } = settle({
        spec: spec(`${RENDERS} ${link(3)}.`),
        verdicts: [found],
      });

      expect(await settled).toMatchObject([{ line: 5, status: "present" }]);
    },
  );

  it.each([
    {
      fault: "names a file the commit does not have",
      cited: cite(3),
      files: {},
    },
    { fault: "points past the end of the file", cited: cite(9) },
    { fault: "points at a blank line", cited: cite(2) },
    { fault: "names no line", cited: cite(3).replace("#L3", "") },
    {
      fault: "carries a hash no line of the file has",
      cited: cite(3, UNWRITTEN_TEST),
    },
    {
      fault: "sits beside a second link that points past the end of the file",
      cited: `${cite(3, RENDERS_TEST)}, ${cite(9)}`,
    },
  ])(
    "leaves a statement whose link $fault to the agent",
    async ({ cited, files }) => {
      const { settled } = settle({
        spec: spec(`${RENDERS} (${cited}).`),
        files,
      });

      expect(await settled).toEqual([]);
    },
  );

  it("leaves a statement linked only to the code that implements it to the agent", async () => {
    const code = "([implemented by `Widget`](../../src/widget.ts#L1))";
    const { settled } = settle({
      spec: spec(`${RENDERS} ${code}.`),
      files: { "src/widget.ts": "export function Widget() {}\n" },
    });

    expect(await settled).toEqual([]);
  });

  it("settles on a link with no hash to a line too short to carry one", async () => {
    const tests =
      'it.each([\n  [404, "not_found"],\n])("maps %s", () => {});\n';
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(1)}.`),
      files: { [TEST_PATH]: tests },
    });

    expect(await settled).toMatchObject([
      { evidence: [{ path: TEST_PATH, start: 1, end: 1, text: "it.each([" }] },
    ]);
  });

  it("follows a hashed link to the line its test moved to", async () => {
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(3, RENDERS_TEST)}.`),
      files: { [TEST_PATH]: `// Moved\n// down.\n${TESTS}` },
    });

    expect(await settled).toMatchObject([
      { evidence: [{ ...RENDERS_EVIDENCE, start: 5, end: 5 }] },
    ]);
  });

  it("gives one evidence entry for a test line a statement cites twice", async () => {
    const { settled } = settle({
      spec: spec(`${RENDERS} (${cite(3)}, ${cite(3, RENDERS_TEST)}).`),
    });

    expect(await settled).toMatchObject([{ evidence: [RENDERS_EVIDENCE] }]);
  });

  it("settles a paragraph when each of its sentences is linked, with every cited line as evidence", async () => {
    const { settled } = settle({
      spec: paragraph(`${RENDERS} ${link(3)}.`, `${COLOUR} ${link(4)}.`),
    });

    expect(await settled).toMatchObject([
      { line: 5, evidence: [{ start: 3 }, { start: 4 }] },
    ]);
  });

  it("leaves a paragraph with one sentence unlinked to the agent", async () => {
    const { settled } = settle({
      spec: paragraph(`${RENDERS} ${link(3)}.`, `${COLOUR}.`),
    });

    expect(await settled).toEqual([]);
  });

  it("leaves a paragraph with one sentence reworded to the agent", async () => {
    const { settled } = settle({
      spec: paragraph(`${RENDERS} ${link(3)}.`, `${COLOUR} name ${link(4)}.`),
    });

    expect(await settled).toEqual([]);
  });

  it("gives evidence the evidence check accepts for a test file with Windows line endings", async () => {
    const tests = TESTS.replaceAll("\n", "\r\n");
    const { settled } = settle({
      spec: spec(`${RENDERS} ${link(3, RENDERS_TEST)}.`),
      files: { [TEST_PATH]: tests },
    });
    const evidence = (await settled).flatMap((entry) => entry.evidence);

    expect(evidence.map((entry) => evidenceIsPresent(entry, tests))).toEqual([
      true,
    ]);
  });

  it("reads a test file two statements cite once", async () => {
    const { read, settled } = settle({
      spec: spec(`${RENDERS} ${link(3)}.`, `${COLOUR} ${link(4)}.`),
    });

    expect(await settled).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("settledOn", () => {
  const LINKED = spec(`${RENDERS} ${link(3)}.`, `${COLOUR} ${link(4)}.`);

  it("derives a listed line's assessment from its links alone, with no earlier spec to compare with", async () => {
    expect(await settledOn(citedSpec(LINKED), [5])).toEqual([
      {
        file: SPEC_PATH,
        line: 5,
        status: "present",
        evidence: [RENDERS_EVIDENCE],
      },
    ]);
  });

  it("gives the same assessments the load step settled for the lines it listed", async () => {
    const settled = await settle({ spec: LINKED }).settled;
    const lines = listedLines(settledListing("99abc43", settled));

    expect(await settledOn(citedSpec(LINKED), lines)).toEqual(settled);
  });

  it.each([
    { line: "whose link no longer resolves", lines: [5], files: {} },
    { line: "that holds no testable statement", lines: [2] },
    { line: "past the end of the spec", lines: [40] },
  ])("gives nothing for a listed line $line", async ({ lines, files }) => {
    expect(await settledOn(citedSpec(LINKED, files), lines)).toEqual([]);
  });

  it("leaves out a linked line the listing does not name", async () => {
    const settled = await settledOn(citedSpec(LINKED), [6]);

    expect(settled.map(({ line }) => line)).toEqual([6]);
  });
});

describe("settledListing", () => {
  it("names the settled lines and the commit the spec was compared with", async () => {
    const settled = await settle({
      spec: spec(`${RENDERS} ${link(3)}.`, `${COLOUR} ${link(4)}.`),
    }).settled;

    expect(JSON.parse(settledListing("99abc43", settled))).toEqual({
      since: "99abc43",
      lines: [5, 6],
    });
  });

  it("names no commit and no lines when nothing was compared", () => {
    expect(JSON.parse(settledListing(null, []))).toEqual({
      since: null,
      lines: [],
    });
  });
});

describe("listedLines", () => {
  it.each([
    { listing: "with no lines field", written: {}, lines: [] },
    {
      listing: "whose lines are not a list",
      written: { lines: "5" },
      lines: [],
    },
    {
      listing: "that mixes line numbers with other values",
      written: { lines: [5, "6", 7.5, null, 8] },
      lines: [5, 8],
    },
  ])("reads $lines from a listing $listing", ({ written, lines }) => {
    expect(listedLines(JSON.stringify(written))).toEqual(lines);
  });
});
