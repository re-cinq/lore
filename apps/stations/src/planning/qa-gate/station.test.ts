import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { qaGateHandle } from "./station.js";
import type { CoverageDeps } from "../coverage-deps.js";

const QUESTIONS = [
  {
    id: "q1",
    section: "scope",
    kind: "plan",
    severity: "blocking",
    source: "b3",
    question: "Billing is out of scope.",
    expected: true,
  },
  {
    id: "q2",
    section: "questions",
    kind: "note",
    severity: "blocking",
    source: "c1",
    question: "The feature is behind a flag.",
    expected: true,
  },
];
const ANSWERS = [
  { id: "q1", answer: true, reason: "Out of scope lists billing." },
  { id: "q2", answer: true, reason: "FR-9 gates the feature." },
];
const handback = () => ({
  nodeId: "qa-gate",
  report: { outcome: "changes_requested" },
});

const SPEC_PATH = "specs/widget/spec.md";

function scene({
  answers = ANSWERS,
  spent = 0,
  raw,
  spec,
}: {
  answers?: unknown[];
  spent?: number;
  raw?: string;
  spec?: string;
} = {}) {
  const produced: Record<string, string> = {};
  const files: Record<string, string> = {
    qa_questions: JSON.stringify(QUESTIONS),
    qa_answers: raw ?? JSON.stringify(answers),
    spec_plan: JSON.stringify({ creates: [{ path: SPEC_PATH }] }),
  };
  const tools: Tools = {
    read: async (need) => Buffer.from(files[need] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const deps: CoverageDeps = {
    readSpec: async (_repo, path) =>
      path === SPEC_PATH ? (spec ?? null) : null,
    listTree: async () => [],
    filedCoverage: async () => null,
    visitsOf: async () => [
      ...Array.from({ length: spent }, handback),
      { nodeId: "qa-gate", report: null },
    ],
  };

  return { handle: qaGateHandle(deps), tools, produced };
}

const brief = {
  visitId: "visit-gate",
  iteration: 1,
  needs: { qa_questions: "blob://q", qa_answers: "blob://a" },
};

const withSpec = {
  ...brief,
  needs: {
    ...brief.needs,
    target: "https://github.com/re-cinq/lore@spec/widget",
    spec_plan: "blob://s",
  },
};

describe("qaGateHandle", () => {
  it("reports success and clears qa_failures with an empty file when every answer and note is true", async () => {
    const { handle, tools, produced } = scene();

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: { qa_failures: "" },
    });
  });

  it("sends the writer back with the failed question in qa_failures", async () => {
    const { handle, tools, produced } = scene({
      answers: [
        { id: "q1", answer: false, reason: "Spec is silent." },
        ANSWERS[1],
      ],
    });

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "changes_requested" },
      produced: {
        qa_failures:
          "These checks failed against the spec. Fix the spec so each one holds:\n- q1: Billing is out of scope. (Spec is silent.)\n",
      },
    });
  });

  it("reports success with the failures listed once five rounds are spent", async () => {
    const { handle, tools, produced } = scene({
      answers: [ANSWERS[0], { id: "q2", answer: false, reason: "Not there." }],
      spent: 5,
    });

    const report = await handle(brief, tools);

    expect({ report, listed: produced.qa_failures?.includes("q2") }).toEqual({
      report: { outcome: "success" },
      listed: true,
    });
  });

  it("reports failed when the answers are not valid JSON", async () => {
    const { handle, tools } = scene({ raw: "not json" });

    const report = await handle(brief, tools);

    expect(report.outcome).toBe("failed");
  });

  it("reports success when each upholding answer quotes the spec on the branch", async () => {
    const { handle, tools } = scene({
      spec: "- Billing is out of scope.\n- The feature is behind a flag.\n",
      answers: [
        { ...ANSWERS[0], evidence: "Billing is out of scope." },
        { ...ANSWERS[1], evidence: "The feature is behind a flag." },
      ],
    });

    const report = await handle(withSpec, tools);

    expect(report).toEqual({ outcome: "success" });
  });

  it("sends the writer back naming an upholding answer whose quote is not in the spec", async () => {
    const { handle, tools, produced } = scene({
      spec: "- Billing is out of scope.\n",
      answers: [
        { ...ANSWERS[0], evidence: "Billing is out of scope." },
        { ...ANSWERS[1], evidence: "It ships behind a flag." },
      ],
    });

    const report = await handle(withSpec, tools);

    expect({ report, failures: produced.qa_failures }).toEqual({
      report: { outcome: "changes_requested" },
      failures:
        "These checks failed against the spec. Fix the spec so each one holds:\n- q2: The feature is behind a flag. (No quote from the spec supports this answer.)\n",
    });
  });
});
