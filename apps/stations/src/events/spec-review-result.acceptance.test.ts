import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type {
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  SPEC_REVIEW_REOPEN_ARG,
  SPEC_REVIEW_RESULT_EVENT,
} from "@re-cinq/lore-shared/review/spec-review.js";
import { describe, expect, it } from "vitest";
import { buildStationHandlers } from "./handlers.js";
import {
  deliverSpecReviewResult,
  replyMarker,
  SPEC_WRITER_ACTOR,
  specReviewResultHandlers,
  type PlanSection,
  type SpecReviewReplyPoster,
  type SpecReviewResultDeps,
  type SpecReviewResultEvent,
} from "./spec-review-result-handlers.js";

const DEFAULT_SECTIONS: PlanSection[] = [
  { slot: "intent", title: "Intent" },
  { slot: "scope", title: "Scope" },
  { slot: "constraints", title: "Constraints" },
  { slot: "delivery", title: "Delivery implications" },
  { slot: "questions", title: "Open questions" },
];

interface HarnessOptions {
  prNumber?: number;
  sections?: PlanSection[];
  reviews?: { id: number; author: string; state: string; body: string }[];
  posted?: string[];
  prComments?: ReviewComment[];
  threads?: ReviewThread[];
  resolveFails?: boolean;
  withoutResolve?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const { prNumber = 261, sections = DEFAULT_SECTIONS } = options;
  const assemblyRuns = new InMemoryAssemblyRuns();
  const asked: Array<{
    planId: string;
    actor: string;
    ops: Record<string, unknown>[];
  }> = [];
  const replies: Array<{ number: number; commentId: number; body: string }> =
    [];
  const comments: Array<{ number: number; body: string }> = [];
  const resolved: string[] = [];

  const pulls: SpecReviewReplyPoster = {
    replyToReviewComment: async (number, commentId, body) => {
      replies.push({ number, commentId, body });
    },
    comment: async (number, body) => {
      comments.push({ number, body });
    },
    listComments: async () => [
      ...(options.prComments ?? []),
      ...(options.posted ?? []).map((body, idx) => ({
        id: idx + 1,
        author: "lore-agent[bot]",
        path: "specs/x/spec.md",
        line: 1,
        body,
        createdAt: "2026-09-24T19:00:00Z",
      })),
    ],
    listIssueComments: async () => [],
    ...(options.withoutResolve
      ? {}
      : {
          listReviewThreads: async () => options.threads ?? [],
          resolveReviewThread: async (threadId: string) => {
            enforceTrue(!options.resolveFails, Error, "cannot resolve thread");
            resolved.push(threadId);
          },
        }),
  };

  const deps: SpecReviewResultDeps = {
    assemblyRuns,
    plans: {
      sectionsOf: async () => sections,
      addQuestions: async (planId, edits) => {
        asked.push({
          planId,
          actor: edits.actor,
          ops: edits.ops as Record<string, unknown>[],
        });
      },
    },
    pullsFor: async () => pulls,
  };

  const createOpenRun = async () => {
    const id = await assemblyRuns.start({
      blueprintName: "feature-planning",
      taskId: "t1",
      repo: "re-cinq/otto",
      args: {
        plan_id: "p1",
        ...(prNumber > 0 ? { pr_number: prNumber } : {}),
        ...(options.reviews
          ? {
              spec_review: {
                pr_number: prNumber,
                comments: [],
                reviews: options.reviews,
              },
            }
          : {}),
      },
    });

    return { id };
  };

  return {
    assemblyRuns,
    asked,
    replies,
    comments,
    resolved,
    deps,
    createOpenRun,
  };
}

function answerEvent(
  overrides: Partial<SpecReviewResultEvent> = {},
): SpecReviewResultEvent {
  return {
    taskId: "t1",
    event: SPEC_REVIEW_RESULT_EVENT,
    content: JSON.stringify({
      plan_questions: [
        {
          slot: "intent",
          question: "Suppress the model, or let it phrase the answer?",
          why: "Line 24 says direct-to-Slack; review comment 12 asks for model phrasing.",
          comment_id: 12,
        },
      ],
      replies: [
        {
          comment_id: 11,
          action: "addressed",
          note: "Named the nine files in FR-005.",
        },
        { comment_id: 12, action: "to_plan" },
      ],
    }),
    ...overrides,
  };
}

const THREAD_11: ReviewThread = {
  id: "PRRT_11",
  isResolved: false,
  comments: [
    {
      databaseId: 11,
      author: "alice",
      body: "Name the files.",
      path: "specs/x/spec.md",
      line: 10,
    },
  ],
};

const THREAD_12: ReviewThread = {
  id: "PRRT_12",
  isResolved: false,
  comments: [
    {
      databaseId: 12,
      author: "bob",
      body: "Model or direct?",
      path: "specs/x/spec.md",
      line: 24,
    },
  ],
};

describe("spec.review.result event", () => {
  it("writes plan questions for to_plan comments, resolves threads for addressed, and re-homes questions missing a slot", async () => {
    const h = harness({ threads: [THREAD_11, THREAD_12] });
    const run = await h.createOpenRun();
    const handler = specReviewResultHandlers(h.deps).get(
      SPEC_REVIEW_RESULT_EVENT,
    )!;

    await handler({
      taskId: "t1",
      event: SPEC_REVIEW_RESULT_EVENT,
      content: JSON.stringify({
        plan_questions: [
          {
            slot: "intent",
            question: "Suppress the model, or let it phrase the answer?",
            why: "Line 24 says direct-to-Slack; review comment 12 asks for model phrasing.",
            comment_id: 12,
          },
          {
            slot: "custom-tool",
            question: "Cap at five tools?",
            why: "No section named custom-tool.",
            comment_id: 13,
          },
        ],
        replies: [
          {
            comment_id: 11,
            action: "addressed",
            note: "Named the nine files in FR-005.",
          },
          { comment_id: 12, action: "to_plan" },
        ],
      }),
    });

    const after = await h.assemblyRuns.getById(run.id);

    expect({
      registeredInStationHandlers: buildStationHandlers().has(
        SPEC_REVIEW_RESULT_EVENT,
      ),
      actor: h.asked[0].actor,
      questions: h.asked[0].ops.map((op) => ({
        questionId: op.questionId,
        slot: op.slot,
        question: op.question,
      })),
      reopen: after?.args[SPEC_REVIEW_REOPEN_ARG],
      repliedComments: h.replies.map((r) => r.commentId),
      resolved: h.resolved,
    }).toEqual({
      registeredInStationHandlers: true,
      actor: SPEC_WRITER_ACTOR,
      questions: [
        {
          questionId: "q-review-c12",
          slot: "intent",
          question: "Suppress the model, or let it phrase the answer?",
        },
        {
          questionId: "q-review-c13",
          slot: "questions",
          question: "Cap at five tools?",
        },
      ],
      reopen: true,
      repliedComments: [11, 12],
      resolved: ["PRRT_11"],
    });
  });

  it("writes the question to the plan with an id keyed on the comment, replies to each comment, resolves only the addressed thread, and flags the run to reopen the plan", async () => {
    const h = harness({ threads: [THREAD_11, THREAD_12] });
    const run = await h.createOpenRun();

    const delivery = await deliverSpecReviewResult(answerEvent(), h.deps);
    const after = await h.assemblyRuns.getById(run.id);
    const asked = h.asked[0];

    expect({
      delivery,
      actor: asked.actor,
      questionId: asked.ops[0].questionId,
      slot: asked.ops[0].slot,
      reopen: after?.args[SPEC_REVIEW_REOPEN_ARG],
      replies: h.replies.map(({ commentId, body }) => ({
        commentId,
        hasMarker: body.startsWith(replyMarker(run.id, commentId)),
        addressed: body.includes("Named the nine files in FR-005."),
        toPlan: body.includes("Sent to the plan as a question"),
      })),
      resolved: h.resolved,
    }).toEqual({
      delivery: {
        outcome: "delivered",
        questions: 1,
        rehomed: 0,
        replied: 2,
        resolved: 1,
      },
      actor: SPEC_WRITER_ACTOR,
      questionId: "q-review-c12",
      slot: "intent",
      reopen: true,
      replies: [
        { commentId: 11, hasMarker: true, addressed: true, toPlan: false },
        { commentId: 12, hasMarker: true, addressed: false, toPlan: true },
      ],
      resolved: ["PRRT_11"],
    });
  });

  it("gives a reworded question for the same review comment the same questionId, and hashes the text only when no comment is named", async () => {
    const h = harness();

    await h.createOpenRun();

    await deliverSpecReviewResult(
      answerEvent({
        content: JSON.stringify({
          plan_questions: [
            {
              slot: "intent",
              question: "First wording?",
              why: "first",
              comment_id: 12,
            },
            {
              slot: "intent",
              question: "Second wording for the same comment?",
              why: "second",
              comment_id: 12,
            },
            {
              slot: "scope",
              question: "Unattached question?",
              why: "from a review body",
            },
          ],
          replies: [],
        }),
      }),
      h.deps,
    );

    const ids = h.asked[0]?.ops.map((op) => op.questionId);

    expect({
      first: ids?.[0],
      secondMatchesFirst: ids?.[1] === ids?.[0],
      third: ids?.[2],
    }).toEqual({
      first: "q-review-c12",
      secondMatchesFirst: true,
      third: expect.stringMatching(/^q-review-[0-9a-z]+$/),
    });
  });

  it("posts a review-body answer as a PR comment naming the review, and resolves nothing for it", async () => {
    const h = harness({
      reviews: [
        {
          id: 90,
          author: "carol",
          state: "CHANGES_REQUESTED",
          body: "Tighten FR-003.",
        },
      ],
    });
    const run = await h.createOpenRun();

    const delivery = await deliverSpecReviewResult(
      answerEvent({
        content: JSON.stringify({
          plan_questions: [],
          replies: [
            { comment_id: 90, action: "addressed", note: "Tightened." },
          ],
        }),
      }),
      h.deps,
    );

    expect({
      delivery,
      replies: h.replies,
      comments: h.comments,
      resolved: h.resolved,
    }).toEqual({
      delivery: {
        outcome: "delivered",
        questions: 0,
        rehomed: 0,
        replied: 1,
        resolved: 0,
      },
      replies: [],
      comments: [
        {
          number: 261,
          body: `${replyMarker(run.id, 90)}

On review 90: Addressed in the latest push to this branch. Tightened.`,
        },
      ],
      resolved: [],
    });
  });

  it("skips a reply whose marker is already on the PR, and still resolves its thread on redelivery", async () => {
    const posted: string[] = [];
    const h = harness({
      posted,
      threads: [THREAD_11, THREAD_12],
    });
    const run = await h.createOpenRun();

    posted.push(`${replyMarker(run.id, 11)}\n\nAddressed.`);

    const delivery = await deliverSpecReviewResult(answerEvent(), h.deps);

    expect({
      delivery,
      repliedComments: h.replies.map((r) => r.commentId),
      resolved: h.resolved,
    }).toEqual({
      delivery: {
        outcome: "delivered",
        questions: 1,
        rehomed: 0,
        replied: 1,
        resolved: 1,
      },
      repliedComments: [12],
      resolved: ["PRRT_11"],
    });
  });

  it("re-homes a question whose slot is not on the plan to a title match or Open questions, and makes a question for a to_plan reply the writer forgot to ask", async () => {
    const h = harness({
      prComments: [
        {
          id: 19,
          author: "dana",
          path: "specs/otto/spec.md",
          line: 88,
          body: `**Tool cap**
Should a skill ever hold more than five tools?`,
          createdAt: "2026-09-25T07:00:00Z",
        },
      ],
    });

    await h.createOpenRun();

    const delivery = await deliverSpecReviewResult(
      answerEvent({
        content: JSON.stringify({
          plan_questions: [
            {
              slot: "delivery-implications",
              question: "Roll out behind a flag?",
              why: "Named the section by its title slug.",
              comment_id: 17,
            },
            {
              slot: "custom-tool",
              question: "Let the user name the tool?",
              why: "No section in the plan has this slot.",
              comment_id: 18,
            },
          ],
          replies: [
            { comment_id: 17, action: "to_plan" },
            { comment_id: 18, action: "to_plan" },
            { comment_id: 19, action: "to_plan" },
          ],
        }),
      }),
      h.deps,
    );

    expect({
      delivery,
      questions: h.asked[0]?.ops.map((op) => ({
        questionId: op.questionId,
        slot: op.slot,
        question: op.question,
      })),
    }).toEqual({
      delivery: {
        outcome: "delivered",
        questions: 3,
        rehomed: 2,
        replied: 3,
        resolved: 0,
      },
      questions: [
        {
          questionId: "q-review-c17",
          slot: "delivery",
          question: "Roll out behind a flag?",
        },
        {
          questionId: "q-review-c18",
          slot: "questions",
          question: "Let the user name the tool?",
        },
        {
          questionId: "q-review-c19",
          slot: "questions",
          question:
            "Review comment 19 on specs/otto/spec.md asks for a decision the plan has not made: Tool cap",
        },
      ],
    });
  });

  it("delivers plan questions and flags the run on a first pass before the spec PR exists", async () => {
    const h = harness({ prNumber: 0 });
    const run = await h.createOpenRun();

    const delivery = await deliverSpecReviewResult(
      answerEvent({
        content: JSON.stringify({
          plan_questions: [
            {
              slot: "scope",
              question: "Include read-only tools in the five-tool cap?",
              why: "Spec-kit NEEDS CLARIFICATION in FR-004.",
            },
          ],
          replies: [],
        }),
      }),
      h.deps,
    );
    const after = await h.assemblyRuns.getById(run.id);

    expect({
      delivery,
      asked: h.asked.map((a) => a.planId),
      reopen: after?.args[SPEC_REVIEW_REOPEN_ARG],
      replies: h.replies,
      comments: h.comments,
    }).toEqual({
      delivery: {
        outcome: "delivered",
        questions: 1,
        rehomed: 0,
        replied: 0,
        resolved: 0,
      },
      asked: ["p1"],
      reopen: true,
      replies: [],
      comments: [],
    });
  });
});
