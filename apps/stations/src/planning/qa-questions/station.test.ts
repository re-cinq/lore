import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { qaQuestionsHandle } from "./station.js";

const PLAN = {
  plan_url: "https://lore.example/plans/p1",
  blocks: [
    {
      id: "b1",
      slot: "scope",
      kind: "paragraph",
      text: "Billing is out.",
      link: "https://lore.example/plans/p1#b1",
    },
  ],
};
const QUESTION = {
  id: "q1",
  section: "scope",
  kind: "plan",
  severity: "blocking",
  source: "b1",
  question: "Billing is out of scope.",
  expected: true,
};

function scene(files: Record<string, string>) {
  const produced: Record<string, string> = {};
  const tools: Tools = {
    read: async (need) => Buffer.from(files[need] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };

  return { tools, produced };
}

const briefOf = (needs: Record<string, string>) => ({
  visitId: "visit-questions",
  iteration: 1,
  needs,
});
const brief = () =>
  briefOf({ qa_questions: "blob://q", plan_blocks: "blob://p" });
const briefWithoutBlocks = () => briefOf({ qa_questions: "blob://q" });

describe("qaQuestionsHandle", () => {
  it("reports success and publishes the questions without their expected values", async () => {
    const { tools, produced } = scene({
      qa_questions: JSON.stringify([QUESTION]),
      plan_blocks: JSON.stringify(PLAN),
    });

    const report = await qaQuestionsHandle()(brief(), tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: {
        qa_blind: JSON.stringify([
          { id: "q1", question: "Billing is out of scope." },
        ]),
        qa_question_errors: "",
      },
    });
  });

  it("sends the generator back naming a question that cites a block the plan does not have", async () => {
    const { tools, produced } = scene({
      qa_questions: JSON.stringify([{ ...QUESTION, source: "b9" }]),
      plan_blocks: JSON.stringify(PLAN),
    });

    const report = await qaQuestionsHandle()(brief(), tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "changes_requested" },
      produced: {
        qa_question_errors:
          "The question set you wrote has these problems. Write the whole set again with each fixed:\n- q1 cites plan block b9, which the plan does not have.\n",
      },
    });
  });

  it("sends the generator back when the file is not a valid question set", async () => {
    const { tools, produced } = scene({
      qa_questions: JSON.stringify([{ id: "q1" }]),
      plan_blocks: JSON.stringify(PLAN),
    });

    const report = await qaQuestionsHandle()(brief(), tools);

    expect({
      report,
      brief: produced.qa_question_errors?.startsWith(
        "The question set you wrote has these problems.",
      ),
    }).toEqual({ report: { outcome: "changes_requested" }, brief: true });
  });

  it("checks only duplicates and emptiness when the run carries no plan blocks", async () => {
    const { tools } = scene({
      qa_questions: JSON.stringify([{ ...QUESTION, source: "b9" }]),
    });

    const report = await qaQuestionsHandle()(briefWithoutBlocks(), tools);

    expect(report).toEqual({ outcome: "success" });
  });

  it("sends the generator back when the run carries no question set at all, naming the file it was to write", async () => {
    const { tools, produced } = scene({ plan_blocks: JSON.stringify(PLAN) });

    const report = await qaQuestionsHandle()(
      briefOf({ plan_blocks: "blob://p" }),
      tools,
    );

    expect({ report, errors: produced.qa_question_errors }).toEqual({
      report: { outcome: "changes_requested" },
      errors: expect.stringContaining(
        "You wrote no /workspace/qa-questions.json",
      ),
    });
  });
});
