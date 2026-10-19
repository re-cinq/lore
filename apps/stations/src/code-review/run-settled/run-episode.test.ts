import { describe, expect, it } from "vitest";
import type { Report, Tools } from "@re-cinq/floor-station";
import type { RunView, VisitView } from "@re-cinq/floor-client";
import {
  agentReportsOf,
  recordingRunEpisode,
  runEpisodeOf,
  type AgentReport,
  type RunEpisode,
} from "./run-episode.js";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const NEXT: Report = { outcome: "success" };
const PR_URL = "https://github.com/re-cinq/lore/pull/412";
const OUTPUT_HASH = `sha256-${"a".repeat(64)}`;

function loopRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    lineId: "implementation-loop",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: "backlog:tickets",
    startItems: { pr_url: { kind: "value", ref: PR_URL, by: "lore" } },
    createdAt: "2026-10-15T09:00:00.000Z",
    outcome: "success",
    reason: null,
    finishedAt: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

function visit(overrides: Partial<VisitView> = {}): VisitView {
  return {
    id: "visit-1",
    runId: "run-1",
    nodeId: "tdd-round",
    iteration: 1,
    stationHash: null,
    agentDefinitionHash: "agent-hash",
    brief: { iteration: 1, needs: {} },
    report: {
      outcome: "success",
      produced: { tdd_done: "fix the digest ordering" },
    },
    worker: null,
    requestedBy: null,
    branch: null,
    deadline: null,
    resumedFrom: null,
    agentSettings: {
      model: "gemini-3.1-pro-preview",
      prompt: "tdd",
      image: "img",
      timeoutMinutes: 30,
    },
    ...overrides,
  };
}

const TDD_ROUND: AgentReport = {
  nodeId: "tdd-round",
  iteration: 2,
  outcome: "success",
  produced: {
    tdd_done: "fix the digest ordering",
    tdd_next: "acceptance green",
  },
};

const FAILED_FIX: AgentReport = {
  nodeId: "fix-ci",
  iteration: 1,
  outcome: "failed",
  error: "pod OOMKilled",
  produced: {},
};

describe("runEpisodeOf", () => {
  it("writes run-1's line, repository, outcome and pull request, then what each agent visit produced", () => {
    expect(runEpisodeOf(loopRun(), [TDD_ROUND])).toEqual({
      repo: "re-cinq/lore",
      agentId: "floor/implementation-loop",
      content: [
        "Run run-1 of implementation-loop on re-cinq/lore ended as success.",
        `Pull request: ${PR_URL}`,
        "",
        "tdd-round #2 (success)",
        "tdd_done: fix the digest ordering",
        "tdd_next: acceptance green",
      ].join("\n"),
    });
  });

  it("writes the run's reason and a failed visit's error in place of what it produced", () => {
    const run = loopRun({
      outcome: "iteration_max",
      reason: "fix-ci: retry budget spent",
      startItems: {},
    });

    expect(runEpisodeOf(run, [FAILED_FIX])?.content).toBe(
      [
        "Run run-1 of implementation-loop on re-cinq/lore ended as iteration_max.",
        "Reason: fix-ci: retry budget spent",
        "",
        "fix-ci #1 (failed)",
        "error: pod OOMKilled",
      ].join("\n"),
    );
  });

  it("cuts a 3,000-character value to 1,000 characters and the episode to 4,000", () => {
    const long: AgentReport = {
      ...TDD_ROUND,
      produced: { pr_body: "x".repeat(3000) },
    };
    const content = runEpisodeOf(loopRun(), [
      long,
      long,
      long,
      long,
      long,
    ])?.content;

    expect(content?.length).toBe(4000);
    expect(content).toContain(`pr_body: ${"x".repeat(999)}…\n`);
  });

  it("writes nothing for a cancelled run", () => {
    expect(runEpisodeOf(loopRun({ outcome: "cancelled" }), [TDD_ROUND])).toBe(
      null,
    );
  });

  it("writes nothing for a run with no agent visit", () => {
    expect(runEpisodeOf(loopRun(), [])).toBe(null);
  });
});

describe("agentReportsOf", () => {
  it("reads a blob hash as the result text of the stored output and keeps an inline value as it is", async () => {
    const reviewed = visit({
      report: {
        outcome: "success",
        produced: { review_output: OUTPUT_HASH, verdict: "approved" },
      },
    });
    const output = `${JSON.stringify({ type: "result", result: "REVIEW_RESULT:APPROVED" })}\n`;

    expect(
      await agentReportsOf([reviewed], (hash) =>
        Promise.resolve(hash === OUTPUT_HASH ? output : null),
      ),
    ).toEqual([
      {
        nodeId: "tdd-round",
        iteration: 1,
        outcome: "success",
        produced: {
          review_output: "REVIEW_RESULT:APPROVED",
          verdict: "approved",
        },
      },
    ]);
  });

  it("leaves out a value whose blob the floor no longer holds", async () => {
    const reviewed = visit({
      report: { outcome: "success", produced: { review_output: OUTPUT_HASH } },
    });

    expect(
      (await agentReportsOf([reviewed], () => Promise.resolve(null)))[0]
        ?.produced,
    ).toEqual({});
  });

  it("carries the error of a failed agent visit", async () => {
    const failed = visit({ report: { outcome: "failed", error: "quota" } });

    expect(await agentReportsOf([failed], () => Promise.resolve(null))).toEqual(
      [
        {
          nodeId: "tdd-round",
          iteration: 1,
          outcome: "failed",
          error: "quota",
          produced: {},
        },
      ],
    );
  });

  it("skips a station visit and an agent visit still open", async () => {
    const station = visit({ agentSettings: null });
    const open = visit({ report: null });

    expect(
      await agentReportsOf([station, open], () => Promise.resolve(null)),
    ).toEqual([]);
  });
});

function scene(
  run: RunView | null,
  post: (episode: RunEpisode) => Promise<void> = () => Promise.resolve(),
) {
  const posted: RunEpisode[] = [];
  const warnings: string[] = [];
  const order: string[] = [];
  const handle = recordingRunEpisode(
    {
      run: () => Promise.resolve(run),
      agentReports: () => Promise.resolve([TDD_ROUND]),
      post: async (episode) => {
        order.push("post");
        await post(episode);
        posted.push(episode);
      },
      warn: (message) => warnings.push(message),
    },
    () => {
      order.push("next");

      return Promise.resolve(NEXT);
    },
  );
  const settle = () =>
    handle(
      {
        visitId: "visit-settled",
        iteration: 1,
        needs: {
          run_id: "run-1",
          line_id: "implementation-loop",
          outcome: "success",
        },
      },
      TOOLS,
    );

  return { posted, warnings, order, settle };
}

describe("recordingRunEpisode", () => {
  it("posts run-1's episode after the wrapped station answered", async () => {
    const { posted, order, settle } = scene(loopRun());

    await settle();

    expect({ order, repos: posted.map((episode) => episode.repo) }).toEqual({
      order: ["next", "post"],
      repos: ["re-cinq/lore"],
    });
  });

  it("answers what the wrapped station answers and logs the failure when the post fails with 503", async () => {
    const { warnings, settle } = scene(loopRun(), () =>
      Promise.reject(new Error("POST /api/session-summary failed: 503")),
    );

    expect({ report: await settle(), warnings }).toEqual({
      report: NEXT,
      warnings: [
        "[run-settled] no episode for run run-1: POST /api/session-summary failed: 503",
      ],
    });
  });

  it("posts nothing when the floor no longer has the run", async () => {
    const { posted, settle } = scene(null);

    await settle();

    expect(posted).toEqual([]);
  });
});
