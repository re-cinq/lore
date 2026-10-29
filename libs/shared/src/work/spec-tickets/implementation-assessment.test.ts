import { describe, expect, it, vi } from "vitest";
import { parseDecomposition } from "../../domain/feature-planning/decomposition-result.js";
import { assessImplementation } from "./implementation-assessment.js";

const SPEC =
  "# Widget\nAn interface.\n## Requirements\n\n- The widget MUST render messages.\n- The widget MUST accept a colour prop.\n";
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

  it("preserves normalized spec lines through artifact serialization", () => {
    const result = decomposition();

    expect(parseDecomposition(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });
});
