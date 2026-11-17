import { describe, expect, it } from "vitest";
import type {
  DecompTask,
  DecompositionResult,
} from "../../domain/feature-planning/decomposition-result.js";
import {
  applyJudgements,
  CANDIDATE_SCORE,
  candidatesOf,
  dedupeReport,
  judgePrompt,
  newTasks,
  parseJudgeAnswer,
  ticketQuery,
  type TaskJudgement,
  type TicketMatch,
} from "./ticket-dedupe.js";

function task(id: string, title: string): DecompTask {
  return {
    id,
    title,
    description: `Build ${title.toLowerCase()}.`,
    depends_on: [],
    parallelizable: false,
    phase: 0,
  };
}

function decompositionOf(...stories: DecompTask[][]): DecompositionResult {
  return {
    spec_commit: "c1",
    stories: stories.map((tasks, index) => ({
      title: `Story ${index + 1}`,
      summary: "",
      acceptance_criteria: [],
      tasks,
    })),
  };
}

function match(
  number: number,
  state: TicketMatch["state"] = "open",
  score = CANDIDATE_SCORE,
): TicketMatch {
  return {
    number,
    title: `Ticket ${number}`,
    state,
    score,
    excerpt: `About ${number}`,
  };
}

const NO_OWN = { ids: new Set<string>(), numbers: new Set<number>() };

function judged(candidates: TicketMatch[], answer: unknown): TaskJudgement {
  return { candidates, answer };
}

function apply(
  decomposition: DecompositionResult,
  judgements: Record<string, TaskJudgement>,
) {
  return applyJudgements(decomposition, new Map(Object.entries(judgements)));
}

describe("candidatesOf", () => {
  it("keeps #8 at the candidate score and drops #9 below it and this spec's own #5", () => {
    const own = { ids: new Set<string>(), numbers: new Set([5]) };
    const tickets = [match(5), match(8), match(9, "open", 0.025)];

    expect(
      candidatesOf({ tickets }, own).map((ticket) => ticket.number),
    ).toEqual([8]);
  });

  it("keeps the 5 best of 7 candidates", () => {
    const tickets = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      match(n, "open", CANDIDATE_SCORE + n / 1000),
    );

    expect(
      candidatesOf({ tickets }, NO_OWN).map((ticket) => ticket.number),
    ).toEqual([7, 6, 5, 4, 3]);
  });
});

describe("newTasks", () => {
  it("leaves out T001, whose id an earlier run filed", () => {
    const own = { ids: new Set(["T001"]), numbers: new Set([5]) };
    const decomposition = decompositionOf([
      task("T001", "Add login"),
      task("T002", "Add logout"),
    ]);

    expect(newTasks(decomposition, own).map((t) => t.id)).toEqual(["T002"]);
  });
});

describe("applyJudgements", () => {
  it("drops T001 as duplicate_of open #7 when the judge says duplicate", () => {
    const result = apply(
      decompositionOf([task("T001", "Add login"), task("T002", "Add logout")]),
      {
        T001: judged([match(7)], {
          verdict: "duplicate",
          ticket: 7,
          why: "same login",
        }),
      },
    );

    expect({
      kept: result.decomposition.stories[0]?.tasks.map((t) => t.id),
      report: result.report,
    }).toEqual({
      kept: ["T002"],
      report: [
        {
          taskId: "T001",
          verdict: "duplicate_of",
          ticket: 7,
          why: "same login",
        },
      ],
    });
  });

  it("drops T001 as done_in closed #9 when the judge says done", () => {
    const result = apply(
      decompositionOf(
        [task("T001", "Add login")],
        [task("T002", "Add logout")],
      ),
      {
        T001: judged([match(9, "closed")], {
          verdict: "done",
          ticket: 9,
          why: "merged",
        }),
      },
    );

    expect(result).toMatchObject({
      decomposition: { stories: [{ title: "Story 2" }] },
      report: [
        { taskId: "T001", verdict: "done_in", ticket: 9, why: "merged" },
      ],
    });
  });

  it("keeps T001 with Related: #4 appended when the judge says related", () => {
    const result = apply(decompositionOf([task("T001", "Add login")]), {
      T001: judged([match(4)], { verdict: "related", ticket: 4, why: "near" }),
    });

    expect(result).toEqual({
      decomposition: decompositionOf([
        {
          ...task("T001", "Add login"),
          description: "Build add login.\n\nRelated: #4",
        },
      ]),
      report: [{ taskId: "T001", verdict: "related", ticket: 4, why: "near" }],
    });
  });

  it("keeps T001 unchanged and reports new when the judge says new", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);

    expect(
      apply(decomposition, {
        T001: judged([match(4)], { verdict: "new", why: "different" }),
      }),
    ).toEqual({
      decomposition,
      report: [{ taskId: "T001", verdict: "new", why: "different" }],
    });
  });

  it("downgrades duplicate of #12, not among the candidates, to related #12", () => {
    const result = apply(decompositionOf([task("T001", "Add login")]), {
      T001: judged([match(4)], { verdict: "duplicate", ticket: 12, why: "x" }),
    });

    expect(result.report).toEqual([
      { taskId: "T001", verdict: "related", ticket: 12, why: "x" },
    ]);
  });

  it("downgrades duplicate of closed #4 and done of open #6 to related", () => {
    const result = apply(
      decompositionOf([task("T001", "Add login"), task("T002", "Add logout")]),
      {
        T001: judged([match(4, "closed")], {
          verdict: "duplicate",
          ticket: 4,
          why: "a",
        }),
        T002: judged([match(6, "open")], {
          verdict: "done",
          ticket: 6,
          why: "b",
        }),
      },
    );

    expect({
      kept: result.decomposition.stories[0]?.tasks.map((t) => t.id),
      verdicts: result.report.map((entry) => entry.verdict),
    }).toEqual({ kept: ["T001", "T002"], verdicts: ["related", "related"] });
  });

  it("keeps T001 and reports judge_failed when the judge answers verdict maybe", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);

    expect(
      apply(decomposition, { T001: judged([match(4)], { verdict: "maybe" }) }),
    ).toMatchObject({
      decomposition,
      report: [{ taskId: "T001", verdict: "judge_failed" }],
    });
  });

  it("keeps T001 and reports the judge_failed it carries when the judge threw", () => {
    const decomposition = decompositionOf([task("T001", "Add login")]);
    const failure: TaskJudgement = {
      failed: "judge_failed",
      reason: "vertex 503",
    };

    expect(apply(decomposition, { T001: failure })).toEqual({
      decomposition,
      report: [
        { taskId: "T001", verdict: "judge_failed", reason: "vertex 503" },
      ],
    });
  });

  it("drops story 2 whose one task is a duplicate, keeping story 1", () => {
    const result = apply(
      decompositionOf(
        [task("T001", "Add login")],
        [task("T002", "Add logout")],
      ),
      {
        T002: judged([match(8)], { verdict: "duplicate", ticket: 8, why: "x" }),
      },
    );

    expect(result.decomposition.stories.map((s) => s.title)).toEqual([
      "Story 1",
    ]);
  });
});

describe("parseJudgeAnswer", () => {
  it("reads verdict done on ticket 9 with its why", () => {
    expect(
      parseJudgeAnswer({ verdict: "done", ticket: 9, why: "merged" }),
    ).toEqual({ verdict: "done", ticket: 9, why: "merged" });
  });

  it("answers null for verdict maybe", () => {
    expect(parseJudgeAnswer({ verdict: "maybe", why: "?" })).toBeNull();
  });
});

describe("judgePrompt", () => {
  it("names the task's title, description and criteria and each candidate's number, state, title and excerpt", () => {
    const prompt = judgePrompt(
      { ...task("T001", "Add login"), acceptance_criteria: ["Logs in"] },
      [match(9, "closed")],
    );
    const parts = [
      "Add login",
      "Build add login.",
      "- Logs in",
      "#9 [closed] Ticket 9",
      "About 9",
    ];

    expect(parts.filter((part) => !prompt.includes(part))).toEqual([]);
  });
});

describe("ticketQuery", () => {
  it("joins title and description cut at 200 characters", () => {
    const long = { ...task("T001", "Add login"), description: "x".repeat(300) };

    expect(ticketQuery(long)).toBe(`Add login\n${"x".repeat(200)}`);
  });
});

describe("dedupeReport", () => {
  it("prints one line per verdict with the judge's why under a heading", () => {
    expect(
      dedupeReport([
        { taskId: "T001", verdict: "duplicate_of", ticket: 7, why: "same" },
        { taskId: "T002", verdict: "search_failed", reason: "no base" },
      ]),
    ).toBe(
      "## Ticket dedupe\n\n- T001: duplicate_of #7 — same\n- T002: kept, search_failed: no base",
    );
  });

  it("says nothing matched when there are no verdicts", () => {
    expect(dedupeReport([])).toBe(
      "## Ticket dedupe\n\nNo new task matched an existing ticket.",
    );
  });
});
