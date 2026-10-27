import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { DoneCheckAnswer } from "@re-cinq/lore-shared/backlog/done-check.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { doneCheckHandle, type DoneCheckDeps } from "./station.js";

const BRANCH = "lore/implementation-loop/issue-42";

const ON = async () => true;

const OFF = async () => false;

const EXPORT_PR: PullRef = {
  repo: "re-cinq/otto",
  number: 57,
  title: "Add the export button",
  branch: "feat/export",
  state: "merged",
  labels: [],
  url: "https://github.com/re-cinq/otto/pull/57",
  mergedAt: "2026-10-20T10:00:00Z",
  body: "Closes #42",
};

function scene(
  over: Partial<DoneCheckDeps> & { verdict?: DoneCheckAnswer } = {},
) {
  const calls: unknown[] = [];
  const judged: string[] = [];
  const tools: Tools = {
    read: () =>
      Promise.resolve(
        Buffer.from("# Add an export button (#42)\nIn `src/export.ts`.\n"),
      ),
    produce: () => Promise.resolve(),
    modelCall: (call) => {
      calls.push(call);

      return Promise.resolve();
    },
    signal: new AbortController().signal,
  };
  const deps: DoneCheckDeps = {
    enabled: ON,
    mergedSince: () => Promise.resolve([EXPORT_PR]),
    touching: () => Promise.resolve([]),
    diffOf: (number) => Promise.resolve(`diff of #${number}`),
    judge: (prompt) => {
      judged.push(prompt);

      return Promise.resolve({
        parsed: over.verdict ?? {
          done: true,
          pull: 57,
          reason: "the button is on main",
        },
        model: "gemini-3-flash-preview",
        costUsd: 0.004,
        inputTokens: 3000,
        outputTokens: 60,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        durationMs: 900,
      });
    },
    ...over,
  };
  const brief = {
    visitId: "visit-done-check",
    iteration: 1,
    needs: {
      target: `https://github.com/re-cinq/otto@${BRANCH}`,
      issue_number: "42",
      ticket: "blob",
    },
  };

  return { run: () => doneCheckHandle(deps)(brief, tools), calls, judged };
}

describe("loop-done-check", () => {
  it("ends the run as already resolved by pull request 57 when the judge finds the ticket done there, and records the model call on the floor", async () => {
    const { run, calls, judged } = scene();

    expect({
      report: await run(),
      calls: calls.length,
      judgedDiff: judged[0]?.includes("diff of #57"),
    }).toEqual({
      report: {
        outcome: "changes_requested",
        produced: {
          dod_resolved:
            "#57 Add the export button (https://github.com/re-cinq/otto/pull/57) already does it: the button is on main",
        },
      },
      calls: 1,
      judgedDiff: true,
    });
  });

  it("goes on to the definition of done with no model call when the check is off, when no merged pull request names the issue, and when the judge says not done", async () => {
    const outcomes = [];

    for (const over of [
      { enabled: OFF },
      { mergedSince: () => Promise.resolve([]) },
      { verdict: { done: false, pull: 57, reason: "only the label" } },
    ]) {
      const { run, calls } = scene(over);

      outcomes.push({ report: await run(), calls: calls.length });
    }

    expect(outcomes).toEqual([
      { report: { outcome: "success" }, calls: 0 },
      { report: { outcome: "success" }, calls: 0 },
      { report: { outcome: "success" }, calls: 1 },
    ]);
  });

  it("goes on to the definition of done when the judge fails, since a check that could not run must never close a ticket", async () => {
    const { run } = scene({
      judge: () => Promise.reject(new Error("quota exceeded")),
    });

    expect(await run()).toEqual({ outcome: "success" });
  });

  it("shows the judge a pull request that touched src/export.ts, which the ticket names, though it never names the ticket, and leaves out one whose diff GitHub refuses", async () => {
    const touched: PullRef = {
      ...EXPORT_PR,
      number: 61,
      body: "",
      title: "Export",
    };
    const huge: PullRef = { ...EXPORT_PR, number: 62, body: "", title: "Huge" };
    const asked: string[] = [];
    const { run, judged } = scene({
      mergedSince: () => Promise.resolve([]),
      touching: (_repo, path) => {
        asked.push(path);

        return Promise.resolve([touched, huge]);
      },
      diffOf: (number) =>
        number === 62
          ? Promise.reject(new Error("diff too large: HTTP 406"))
          : Promise.resolve(`diff of #${number}`),
      verdict: { done: true, pull: 61, reason: "the export is on main" },
    });

    expect({
      report: await run(),
      asked,
      shownHuge: judged[0]?.includes("#62"),
    }).toEqual({
      report: {
        outcome: "changes_requested",
        produced: {
          dod_resolved:
            "#61 Export (https://github.com/re-cinq/otto/pull/57) already does it: the export is on main",
        },
      },
      asked: ["src/export.ts"],
      shownHuge: false,
    });
  });
});
