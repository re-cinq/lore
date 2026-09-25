import { describe, it, expect } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type {
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  SPEC_REVIEW_REOPEN_ARG,
  SPEC_REVIEW_RESULT_EVENT,
} from "@re-cinq/lore-shared/review/spec-review.js";
import type { AgentFileEvent } from "./agent-events.js";
import {
  deliverSpecReviewResult,
  replyMarker,
  type SpecReviewReplyPoster,
} from "./spec-review-result.js";

const TASK = "t1";

function fileEvent(content: string | null, over: Partial<AgentFileEvent> = {}) {
  return {
    taskId: TASK,
    agentCrName: "abc-write",
    event: SPEC_REVIEW_RESULT_EVENT,
    path: "spec-review-result.json",
    content,
    reason: null,
    uploaded: false,
    ...over,
  } satisfies AgentFileEvent;
}

async function reworkRun(args: Record<string, unknown> = {}) {
  const port = new InMemoryAssemblyRuns();
  const id = await port.start({
    blueprintName: "feature-planning",
    repo: "re-cinq/lore",
    branch: "plan/p1",
    taskId: TASK,
    args: { plan_id: "p1", pr_number: 42, ...args },
  });

  await port.markRunning(id);

  return { port, id };
}

class RecordingPulls implements SpecReviewReplyPoster {
  readonly replies: Array<{ number: number; commentId: number; body: string }> =
    [];
  readonly comments: Array<{ number: number; body: string }> = [];
  readonly resolves: string[] = [];

  constructor(
    private readonly seed: { posted?: string[]; threads?: ReviewThread[] },
  ) {}

  async replyToReviewComment(number: number, commentId: number, body: string) {
    this.replies.push({ number, commentId, body });
  }

  async comment(number: number, body: string) {
    this.comments.push({ number, body });
  }

  async listComments() {
    return (this.seed.posted ?? []).map(
      (body, index) => ({ id: index, body }) as ReviewComment,
    );
  }

  async listIssueComments() {
    return [];
  }

  async listReviewThreads() {
    return this.seed.threads ?? [];
  }

  async resolveReviewThread(threadId: string) {
    this.resolves.push(threadId);
  }
}

function recordingPulls(seed: { posted?: string[]; threads?: ReviewThread[] }) {
  const pulls = new RecordingPulls(seed);

  return {
    pulls,
    replies: pulls.replies,
    resolves: pulls.resolves,
    comments: pulls.comments,
  };
}

function recordingPlans() {
  const questions: Array<{ planId: string; edits: unknown }> = [];

  return {
    questions,
    plans: {
      addQuestions: async (planId: string, edits: unknown) => {
        questions.push({ planId, edits });
      },
    },
  };
}

const thread = (id: string, databaseId: number): ReviewThread => ({
  id,
  isResolved: false,
  isOutdated: false,
  comments: [{ databaseId }],
});

describe("deliverSpecReviewResult", () => {
  it("adds 2 questions to plan p1 — one keyed on comment 77 as q-review-c77, one on its text — and flags run for a reopen", async () => {
    const { port, id } = await reworkRun();
    const { questions, plans } = recordingPlans();
    const { pulls } = recordingPulls({});
    const answer = {
      plan_questions: [
        {
          slot: "scope",
          question: "Which service owns it?",
          why: "Two do.",
          comment_id: 77,
        },
        { slot: "scope", question: "Is the CLI in?" },
      ],
      replies: [],
    };

    const delivery = await deliverSpecReviewResult(
      fileEvent(JSON.stringify(answer)),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );
    const again = await deliverSpecReviewResult(
      fileEvent(JSON.stringify(answer)),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({
      delivery,
      again,
      questions,
      reopen: (await port.getById(id))?.args[SPEC_REVIEW_REOPEN_ARG],
    }).toEqual({
      delivery: { outcome: "delivered", questions: 2, replied: 0, resolved: 0 },
      again: { outcome: "delivered", questions: 2, replied: 0, resolved: 0 },
      questions: [
        {
          planId: "p1",
          edits: {
            actor: "spec-writer",
            ops: [
              {
                op: "add-question",
                slot: "scope",
                questionId: "q-review-c77",
                question: "Which service owns it?",
                why: "Two do.",
                kind: "text",
                options: [],
              },
              {
                op: "add-question",
                slot: "scope",
                questionId: expect.stringMatching(/^q-review-[0-9a-f]{1,8}$/),
                question: "Is the CLI in?",
                why: "",
                kind: "text",
                options: [],
              },
            ],
          },
        },
        questions[0],
      ],
      reopen: true,
    });
  });

  it("replies to addressed comment 9001 and resolves its thread, replies to to_plan comment 9002 leaving its thread open", async () => {
    const { port, id } = await reworkRun();
    const { plans } = recordingPlans();
    const { pulls, replies, resolves } = recordingPulls({
      threads: [thread("T1", 9001), thread("T2", 9002)],
    });

    const delivery = await deliverSpecReviewResult(
      fileEvent(
        JSON.stringify({
          plan_questions: [],
          replies: [
            {
              comment_id: 9001,
              action: "addressed",
              note: "Renamed the flag.",
            },
            { comment_id: 9002, action: "to_plan" },
          ],
        }),
      ),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({ delivery, replies, resolves }).toEqual({
      delivery: { outcome: "delivered", questions: 0, replied: 2, resolved: 1 },
      replies: [
        {
          number: 42,
          commentId: 9001,
          body: `${replyMarker(id, 9001)}\n\nAddressed in the latest push to this branch. Renamed the flag.`,
        },
        {
          number: 42,
          commentId: 9002,
          body: `${replyMarker(id, 9002)}\n\nSent to the plan as a question for its people to settle; the spec keeps what the plan says until they answer.`,
        },
      ],
      resolves: ["T1"],
    });
  });

  it("answers review 5000, which sits in no thread, as a comment on PR 42 rather than a thread reply, and resolves nothing for it", async () => {
    const { port, id } = await reworkRun({
      spec_review: JSON.stringify({
        pr_number: 42,
        reviews: [
          {
            id: 5000,
            author: "gedaiu",
            state: "COMMENTED",
            body: "Two things.",
          },
        ],
        comments: [],
      }),
    });
    const { plans } = recordingPlans();
    const { pulls, replies, comments, resolves } = recordingPulls({});

    const delivery = await deliverSpecReviewResult(
      fileEvent(
        JSON.stringify({
          plan_questions: [],
          replies: [
            { comment_id: 5000, action: "addressed", note: "Both done." },
          ],
        }),
      ),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({ delivery, replies, comments, resolves }).toEqual({
      delivery: { outcome: "delivered", questions: 0, replied: 1, resolved: 0 },
      replies: [],
      comments: [
        {
          number: 42,
          body: `${replyMarker(id, 5000)}\n\nOn review 5000: Addressed in the latest push to this branch. Both done.`,
        },
      ],
      resolves: [],
    });
  });

  it("still resolves the thread of addressed comment 9001 when its reply was already on PR 42 but the thread stayed open", async () => {
    const { port, id } = await reworkRun();
    const { plans } = recordingPlans();
    const { pulls, replies, resolves } = recordingPulls({
      posted: [
        `${replyMarker(id, 9001)}\n\nAddressed in the latest push to this branch.`,
      ],
      threads: [thread("T1", 9001)],
    });

    const delivery = await deliverSpecReviewResult(
      fileEvent(
        JSON.stringify({
          plan_questions: [],
          replies: [{ comment_id: 9001, action: "addressed" }],
        }),
      ),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({ delivery, replies, resolves }).toEqual({
      delivery: { outcome: "delivered", questions: 0, replied: 0, resolved: 1 },
      replies: [],
      resolves: ["T1"],
    });
  });

  it("skips the reply to comment 9001 whose marker is already on PR 42", async () => {
    const { port, id } = await reworkRun();
    const { plans } = recordingPlans();
    const { pulls, replies } = recordingPulls({
      posted: [`${replyMarker(id, 9001)}\n\nAddressed in the latest push.`],
    });

    const delivery = await deliverSpecReviewResult(
      fileEvent(
        JSON.stringify({
          plan_questions: [],
          replies: [{ comment_id: 9001, action: "addressed" }],
        }),
      ),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({ delivery, replies }).toEqual({
      delivery: { outcome: "delivered", questions: 0, replied: 0, resolved: 0 },
      replies: [],
    });
  });

  it("reports a file that is not a spec review result as invalid without touching plan or PR", async () => {
    const { port } = await reworkRun();
    const { questions, plans } = recordingPlans();
    const { pulls, replies } = recordingPulls({});

    const brokenJson = await deliverSpecReviewResult(fileEvent("{nope"), {
      assemblyRuns: port,
      plans,
      pullsFor: async () => pulls,
    });
    const wrongShape = await deliverSpecReviewResult(
      fileEvent(JSON.stringify({ replies: "all of them" })),
      { assemblyRuns: port, plans, pullsFor: async () => pulls },
    );

    expect({ brokenJson, wrongShape, questions, replies }).toEqual({
      brokenJson: {
        outcome: "invalid",
        error: expect.stringMatching(/^not JSON/),
      },
      wrongShape: {
        outcome: "invalid",
        error: expect.stringMatching(/^not a spec review result/),
      },
      questions: [],
      replies: [],
    });
  });

  it("skips a planning.result event, an answer the agent never produced, and a run with no PR", async () => {
    const { port } = await reworkRun();
    const noPr = new InMemoryAssemblyRuns();

    await noPr.markRunning(
      await noPr.start({
        blueprintName: "feature-planning",
        repo: "re-cinq/lore",
        branch: "plan/p2",
        taskId: TASK,
        args: { plan_id: "p2" },
      }),
    );
    const { plans } = recordingPlans();
    const { pulls } = recordingPulls({});
    const deliver = (
      event: AgentFileEvent,
      assemblyRuns: InMemoryAssemblyRuns = port,
    ) =>
      deliverSpecReviewResult(event, {
        assemblyRuns,
        plans,
        pullsFor: async () => pulls,
      });
    const answer = JSON.stringify({ plan_questions: [], replies: [] });

    expect({
      foreign: await deliver(fileEvent(answer, { event: "planning.result" })),
      missing: await deliver(fileEvent(null, { reason: "not produced" })),
      noPr: await deliver(fileEvent(answer), noPr),
    }).toEqual({
      foreign: { outcome: "skipped", error: "not a spec review result" },
      missing: { outcome: "skipped", error: "no answer (not produced)" },
      noPr: { outcome: "skipped", error: "no open run with a plan and a PR" },
    });
  });
});
