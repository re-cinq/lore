import { describe, expect, it, vi } from "vitest";
import {
  parseDecomposition,
  type StatementAssessment,
} from "../../domain/feature-planning/decomposition-result.js";
import { assessImplementation } from "./implementation-assessment.js";

const SPEC =
  "# Widget\nAn interface.\n## Requirements\n\n- The widget MUST render messages.\n- The widget MUST accept a colour prop.\n";
const LEAD_IN_SPEC = `${SPEC}\n**Independent Test:** Render one message and look for it.\n`;
const EVIDENCE = {
  path: "src/widget.ts",
  start: 1,
  end: 1,
  text: "ChatMessageList",
};

function decomposition(status = "present", evidence: unknown[] = [EVIDENCE]) {
  return parseDecomposition({
    spec_commit: "merge123",
    statements: [
      { file: "specs/widget/spec.md", line: 5, status, evidence },
      {
        file: "specs/widget/spec.md",
        line: 6,
        status: "missing",
        evidence: [],
      },
    ],
    stories: [
      {
        title: "Messages",
        tasks: [
          { id: "T001", description: "Render messages", spec_lines: [5] },
        ],
      },
    ],
  });
}

function assess(result = decomposition(), spec = SPEC) {
  const read = vi.fn(async (path: string) =>
    path === "src/widget.ts" ? "export function ChatMessageList() {}\n" : null,
  );

  return {
    read,
    result: assessImplementation(result, {
      spec,
      specPath: "specs/widget/spec.md",
      commit: "merge123",
      read,
    }),
  };
}

describe("assessImplementation", () => {
  it("verifies present message rendering without test links and keeps the task id", async () => {
    const checked = await assess().result;

    expect(checked).toMatchObject({
      objections: [],
      decomposition: {
        statements: [
          { line: 5, status: "present" },
          { line: 6, status: "missing" },
        ],
        stories: [{ tasks: [{ id: "T001" }] }],
      },
    });
  });

  it.each([
    { ...EVIDENCE, path: "missing.ts" },
    { ...EVIDENCE, text: "InventedWidget" },
    { ...EVIDENCE, start: 0 },
    { ...EVIDENCE, end: 3 },
    { ...EVIDENCE, start: 2, end: 1 },
    { ...EVIDENCE, text: " " },
    { ...EVIDENCE, path: "../src/widget.ts" },
  ])("restores missing work for rejected evidence %j", async (evidence) => {
    expect(
      await assess(decomposition("present", [evidence])).result,
    ).toMatchObject({
      objections: [expect.stringContaining("line 5")],
      decomposition: {
        statements: [
          { status: "missing", evidence: [] },
          { status: "missing" },
        ],
      },
    });
  });

  it("rejects a symbol outside its cited line range", async () => {
    const result = await assessImplementation(decomposition(), {
      spec: SPEC,
      specPath: "specs/widget/spec.md",
      commit: "merge123",
      read: async () => "unrelated\nChatMessageList",
    });

    expect(result.objections).toEqual([expect.stringContaining("line 5")]);
  });

  it("rejects a decomposition read at another commit", async () => {
    const result = decomposition();

    result.spec_commit = "later-main";
    expect((await assess(result).result).objections).toEqual(
      expect.arrayContaining([expect.stringContaining("merge123")]),
    );
  });

  it("reads repeated evidence for one file once", async () => {
    const result = decomposition();

    result.statements![1] = { ...result.statements![0], line: 6 };
    const checked = assess(result);

    await checked.result;
    expect(checked.read.mock.calls).toEqual([["src/widget.ts"]]);
  });

  it("requires remaining work and verified in-place evidence for partial tasks", async () => {
    const result = decomposition("partial");

    result.stories[0].tasks[0].remaining = "Add the colour prop";
    expect(await assess(result).result).toMatchObject({
      objections: [expect.stringContaining("in_place")],
    });
  });

  it("reports broken linked tests without rejecting valid source evidence", async () => {
    const spec = SPEC.replace(
      "render messages.",
      "render messages. ([validated by renders messages](src/widget.test.ts#L1))",
    );

    expect(await assess(decomposition(), spec).result).toMatchObject({
      objections: [],
      diagnostics: [expect.stringContaining("src/widget.test.ts")],
    });
  });

  it("rejects present statements when their task still describes remaining work", async () => {
    const result = decomposition();

    result.stories[0].tasks[0].remaining = "Add the colour prop";
    expect((await assess(result).result).objections).toEqual([
      expect.stringContaining("remaining work conflicts with present"),
    ]);
  });

  it("drops line 8, an Independent Test lead-in, from T001's spec lines and verifies T001 on line 5 alone", async () => {
    const result = decomposition();

    result.stories[0].tasks[0].spec_lines = [{ line: 5 }, { line: 8 }];
    expect(await assess(result, LEAD_IN_SPEC).result).toMatchObject({
      objections: [],
      decomposition: {
        stories: [{ tasks: [{ id: "T001", spec_lines: [{ line: 5 }] }] }],
      },
    });
  });

  it("still rejects T001 citing line 3, the Requirements heading, where no statement starts", async () => {
    const result = decomposition();

    result.stories[0].tasks[0].spec_lines = [{ line: 5 }, { line: 3 }];
    expect((await assess(result, LEAD_IN_SPEC).result).objections).toEqual([
      expect.stringContaining(
        "T001: spec_lines must name exact starting lines",
      ),
    ]);
  });

  it("preserves normalized spec lines through artifact serialization", () => {
    const result = decomposition();

    expect(parseDecomposition(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });

  it("hands back the missing colour prop on line 6 while its linked test exists, naming the test", async () => {
    expect(await assessTested(decomposition())).toMatchObject({
      objections: [
        expect.stringContaining(
          "specs/widget/spec.md line 6: missing or unassessed, but its linked test src/widget.test.ts#L1 exists",
        ),
      ],
    });
  });

  it("hands back the colour prop on line 6 when no statement entry assesses it and its linked test exists", async () => {
    const result = decomposition();

    result.statements = result.statements!.slice(0, 1);
    expect((await assessTested(result)).objections).toEqual([
      expect.stringContaining("line 6: missing or unassessed"),
    ]);
  });

  it("keeps the missing colour prop and its reason when the claim says why its linked test does not show it", async () => {
    const result = decomposition();
    const reason = "The test only renders the default colour.";

    result.statements![1] = { ...result.statements![1], reason };
    expect(await assessTested(result)).toMatchObject({
      objections: [],
      decomposition: { statements: [{ line: 5 }, { line: 6, reason }] },
    });
  });

  it("raises nothing for the missing colour prop when its linked test is not at the commit", async () => {
    expect(
      (await assessTested(decomposition(), WIDGET_SOURCE)).objections,
    ).toEqual([]);
  });

  it("raises nothing for the missing colour prop when its test link sits mid-sentence, outside the trailing link group", async () => {
    const spec = SPEC.replace(
      "accept a colour prop.",
      "accept a colour prop ([validated by accepts a colour prop](src/widget.test.ts#L1)) for its border.",
    );

    expect(
      (await assessTested(decomposition(), WIDGET_AND_TEST, spec)).objections,
    ).toEqual([]);
  });

  it("applies no linked-test rule to an explicit requirement part, as triage supplies", async () => {
    const result = await assessImplementation(decomposition(), {
      spec: testedSpec(),
      specPath: "specs/widget/spec.md",
      commit: "merge123",
      read: async (path) => WIDGET_AND_TEST[path] ?? null,
      parts: [
        { line: 5, text: "The widget MUST render messages." },
        { line: 6, text: "The widget MUST accept a colour prop." },
      ],
    });

    expect(result.objections).toEqual([]);
  });

  it("hands back the missing colour prop when its hashed link cites line 9 and the test now sits on line 1", async () => {
    const spec = SPEC.replace(
      "accept a colour prop.",
      `accept a colour prop. ([validated by accepts a colour prop @${ANCHOR_HASH_OF_THE_COLOUR_TEST_LINE}](src/widget.test.ts#L9))`,
    );

    expect(
      (await assessTested(decomposition(), WIDGET_AND_TEST, spec)).objections,
    ).toEqual([expect.stringContaining("line 6: missing or unassessed")]);
  });

  it("takes the colour prop on line 6 as present on its settled test line when the agent leaves it missing without a reason", async () => {
    expect(await assessSettled(decomposition())).toMatchObject({
      objections: [],
      decomposition: { statements: [{ line: 5 }, SETTLED] },
    });
  });

  it("takes the colour prop on line 6 as settled when no statement entry assesses it", async () => {
    const result = decomposition();

    result.statements = result.statements!.slice(0, 1);
    expect(await assessSettled(result)).toMatchObject({
      objections: [],
      decomposition: { statements: [{ line: 5 }, SETTLED] },
    });
  });

  it("keeps the settled colour prop missing with its reason when the agent says why its test does not show it", async () => {
    const result = decomposition();
    const reason = "The test only renders the default colour.";

    result.statements![1] = { ...result.statements![1], reason };
    expect(await assessSettled(result)).toMatchObject({
      objections: [],
      decomposition: {
        statements: [{ line: 5 }, { line: 6, status: "missing", reason }],
      },
    });
  });

  it("keeps the settled colour prop when the agent claims it present with evidence that does not verify", async () => {
    const result = decomposition();

    result.statements![1] = {
      ...result.statements![1],
      status: "present",
      evidence: [{ ...EVIDENCE, text: "InventedWidget" }],
    };
    expect(await assessSettled(result)).toMatchObject({
      objections: [],
      decomposition: { statements: [{ line: 5 }, SETTLED] },
    });
  });

  it("still refuses a partial claim on the settled colour prop whose evidence does not verify", async () => {
    const result = decomposition();

    result.statements![1] = {
      ...result.statements![1],
      status: "partial",
      evidence: [{ ...EVIDENCE, text: "InventedWidget" }],
    };
    expect((await assessSettled(result)).objections).toEqual([
      expect.stringContaining("line 6: evidence rejected"),
    ]);
  });

  it("hands back the colour prop when its settled test line does not verify at the commit", async () => {
    const stale = {
      ...SETTLED,
      evidence: [{ ...SETTLED.evidence[0], text: "gone" }],
    };

    expect((await assessSettled(decomposition(), [stale])).objections).toEqual([
      expect.stringContaining("line 6: missing or unassessed"),
    ]);
  });

  it("settles nothing on an explicit requirement part, as triage supplies", async () => {
    const result = await assessImplementation(decomposition(), {
      spec: testedSpec(),
      specPath: "specs/widget/spec.md",
      commit: "merge123",
      read: async (path) => WIDGET_AND_TEST[path] ?? null,
      parts: [
        { line: 5, text: "The widget MUST render messages." },
        { line: 6, text: "The widget MUST accept a colour prop." },
      ],
      settled: [SETTLED],
    });

    expect(result).toMatchObject({
      objections: [],
      decomposition: {
        statements: [
          { line: 5, status: "present" },
          { line: 6, status: "missing", evidence: [] },
        ],
      },
    });
  });
});

const ANCHOR_HASH_OF_THE_COLOUR_TEST_LINE = "420663fb";

const SETTLED: StatementAssessment = {
  file: "specs/widget/spec.md",
  line: 6,
  status: "present",
  evidence: [
    {
      path: "src/widget.test.ts",
      start: 1,
      end: 1,
      text: 'it("accepts a colour prop", () => {});',
    },
  ],
};

function assessSettled(
  result: ReturnType<typeof decomposition>,
  settled: StatementAssessment[] = [SETTLED],
) {
  return assessImplementation(result, {
    spec: testedSpec(),
    specPath: "specs/widget/spec.md",
    commit: "merge123",
    read: async (path) => WIDGET_AND_TEST[path] ?? null,
    settled,
  });
}

const WIDGET_SOURCE: Record<string, string> = {
  "src/widget.ts": "export function ChatMessageList() {}\n",
};
const WIDGET_AND_TEST: Record<string, string> = {
  ...WIDGET_SOURCE,
  "src/widget.test.ts": 'it("accepts a colour prop", () => {});\n',
};

function testedSpec(): string {
  return SPEC.replace(
    "accept a colour prop.",
    "accept a colour prop. ([validated by accepts a colour prop](src/widget.test.ts#L1))",
  );
}

function assessTested(
  result: ReturnType<typeof decomposition>,
  files: Record<string, string> = WIDGET_AND_TEST,
  spec: string = testedSpec(),
) {
  return assessImplementation(result, {
    spec,
    specPath: "specs/widget/spec.md",
    commit: "merge123",
    read: async (path) => files[path] ?? null,
  });
}
