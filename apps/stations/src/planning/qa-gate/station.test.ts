import { describe, expect, it } from "vitest";
import type { Handle } from "@re-cinq/floor-station";
import { visitBag } from "../visit-bag.fixtures.js";
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
const Q1_FALSE = { id: "q1", answer: false, reason: "Spec is silent." };
const handback = () => ({
  nodeId: "qa-gate",
  report: { outcome: "changes_requested" },
});
const secondOpinion = () => ({
  nodeId: "qa-recheck",
  report: { outcome: "success" },
});

const SPEC_PATH = "specs/widget/spec.md";

interface Scene {
  questions?: unknown[];
  answers?: unknown[];
  recheck?: unknown[];
  history?: number[];
  spent?: number;
  raw?: string;
  spec?: string;
}

function scene(options: Scene = {}) {
  const { tools, produced, given } = visitBag(
    filesOf(options),
    optionalFilesOf(options),
  );
  const deps: CoverageDeps = {
    readSpec: async (_repo, path) =>
      path === SPEC_PATH ? (options.spec ?? null) : null,
    listTree: async () => [],
    filedCoverage: async () => null,
    visitsOf: async () => visitsOf(options),
  };

  const gate = qaGateHandle(deps);
  const handle: Handle = (brief, visitTools) => gate(given(brief), visitTools);

  return { handle, tools, produced };
}

function filesOf(options: Scene): Record<string, string> {
  const { questions = QUESTIONS, answers = ANSWERS } = options;

  return {
    qa_questions: JSON.stringify(questions),
    qa_answers: options.raw ?? JSON.stringify(answers),
    spec_plan: JSON.stringify({ creates: [{ path: SPEC_PATH }] }),
  };
}

function optionalFilesOf({ recheck, history }: Scene): Record<string, string> {
  return {
    ...(recheck && { qa_recheck_answers: JSON.stringify(recheck) }),
    ...(history && { qa_history: JSON.stringify(history) }),
  };
}

function visitsOf({ spent = 0, recheck }: Scene) {
  return [
    ...Array.from({ length: spent }, handback),
    ...(recheck ? [secondOpinion()] : []),
    { nodeId: "qa-gate", report: null },
  ];
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

const FAILURE_BRIEF =
  "These checks failed against the spec. Fix the spec so each one holds:\n- q1 [scope]: Billing is out of scope. (Spec is silent.)\n";

describe("qaGateHandle", () => {
  it("reports success and clears qa_failures with an empty file when every answer and note is true", async () => {
    const { handle, tools, produced } = scene();

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "success" },
      produced: { qa_failures: "", qa_advisory: "", qa_history: "[0]" },
    });
  });

  it("asks a second pod to answer only the failed questions before it counts a failure", async () => {
    const { handle, tools, produced } = scene({
      answers: [Q1_FALSE, ANSWERS[1]],
    });

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "recheck" },
      produced: {
        qa_recheck_blind: JSON.stringify([
          { id: "q1", question: "Billing is out of scope." },
        ]),
      },
    });
  });

  it("sends the writer back with the failure both pods agree on in qa_failures", async () => {
    const { handle, tools, produced } = scene({
      answers: [Q1_FALSE, ANSWERS[1]],
      recheck: [Q1_FALSE],
    });

    const report = await handle(brief, tools);

    expect({ report, produced }).toEqual({
      report: { outcome: "changes_requested" },
      produced: {
        qa_failures: FAILURE_BRIEF,
        qa_advisory: "",
        qa_history: "[1]",
        redo_sections: JSON.stringify({ round: 1, sections: ["scope"] }),
      },
    });
  });

  it("drops a failure the second pod answers as expected", async () => {
    const { handle, tools, produced } = scene({
      answers: [Q1_FALSE, ANSWERS[1]],
      recheck: [ANSWERS[0]],
    });

    const report = await handle(brief, tools);

    expect({ report, failures: produced.qa_failures }).toEqual({
      report: { outcome: "success" },
      failures: "",
    });
  });

  it("numbers the redo request by the rounds already spent", async () => {
    const { handle, tools, produced } = scene({
      answers: [Q1_FALSE, ANSWERS[1]],
      recheck: [Q1_FALSE],
      spent: 2,
    });

    await handle(brief, tools);

    expect(JSON.parse(produced.redo_sections ?? "null")).toEqual({
      round: 3,
      sections: ["scope"],
    });
  });

  it("reports success with the failures listed once five rounds are spent, without a second look", async () => {
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

  it("stops asking when the failures did not fall since the last round", async () => {
    const { handle, tools, produced } = scene({
      answers: [Q1_FALSE, ANSWERS[1]],
      recheck: [Q1_FALSE],
      history: [1],
      spent: 1,
    });

    const report = await handle(brief, tools);

    expect({ report, history: produced.qa_history }).toEqual({
      report: { outcome: "success" },
      history: "[1,1]",
    });
  });

  it("lists a failed advisory question apart and does not hold the pull request for it", async () => {
    const { handle, tools, produced } = scene({
      questions: [{ ...QUESTIONS[0], severity: "advisory" }, QUESTIONS[1]],
      answers: [Q1_FALSE, ANSWERS[1]],
    });

    const report = await handle(brief, tools);

    expect({ report, advisory: produced.qa_advisory }).toEqual({
      report: { outcome: "success" },
      advisory:
        "These checks failed against the spec but did not hold up the pull request:\n- q1 [scope]: Billing is out of scope. (Spec is silent.)\n",
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
    const unquoted = [
      { ...ANSWERS[0], evidence: "Billing is out of scope." },
      { ...ANSWERS[1], evidence: "It ships behind a flag." },
    ];
    const { handle, tools, produced } = scene({
      spec: "- Billing is out of scope.\n",
      answers: unquoted,
      recheck: [unquoted[1]],
    });

    const report = await handle(withSpec, tools);

    expect({ report, failures: produced.qa_failures }).toEqual({
      report: { outcome: "changes_requested" },
      failures:
        "These checks failed against the spec. Fix the spec so each one holds:\n- q2 [questions]: The feature is behind a flag. (No quote from the spec supports this answer.)\n",
    });
  });
});
