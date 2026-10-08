import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { qaGateHandle } from "./station.js";
import type { CoverageDeps } from "../coverage-deps.js";

const QUESTION = {
  id: "q1",
  section: "scope",
  kind: "plan",
  question: "Is billing out of scope?",
  answer: true,
  reason: "Out of scope lists billing.",
};
const NOTE = {
  id: "n1",
  kind: "comment",
  text: "Keep it behind a flag.",
  satisfied: true,
  reason: "FR-9 gates the feature.",
};
const handback = () => ({
  nodeId: "qa-gate",
  report: { outcome: "changes_requested" },
});

function scene({
  questions = [QUESTION],
  notes = [NOTE],
  spent = 0,
  raw,
}: {
  questions?: unknown[];
  notes?: unknown[];
  spent?: number;
  raw?: string;
} = {}) {
  const produced: Record<string, string> = {};
  const files: Record<string, string> = {
    qa_answers: raw ?? JSON.stringify(questions),
    plan_notes: JSON.stringify(notes),
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
    readSpec: async () => null,
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
  needs: { qa_answers: "blob://a", plan_notes: "blob://n" },
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
      questions: [{ ...QUESTION, answer: false, reason: "Spec is silent." }],
    });

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "changes_requested" },
      produced: {
        qa_failures:
          "These checks failed against the spec. Fix the spec so each one holds:\n- q1: Is billing out of scope? (Spec is silent.)\n",
      },
    });
  });

  it("reports success with the failures listed once five rounds are spent", async () => {
    const { handle, tools, produced } = scene({
      notes: [{ ...NOTE, satisfied: false, reason: "Not in the spec." }],
      spent: 5,
    });

    const report = await handle(brief, tools);

    expect({ report, listed: produced.qa_failures?.includes("n1") }).toEqual({
      report: { outcome: "success" },
      listed: true,
    });
  });

  it("reports failed when the answers are not valid JSON", async () => {
    const { handle, tools } = scene({ raw: "not json" });

    const report = await handle(brief, tools);

    expect(report.outcome).toBe("failed");
  });
});
