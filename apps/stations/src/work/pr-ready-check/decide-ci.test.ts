import { describe, it, expect } from "vitest";
import { decideCiReady } from "./decide-ci.js";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

const check = (over: Partial<CheckRun> = {}): CheckRun => ({
  name: "test",
  status: "completed",
  conclusion: "success",
  ...over,
});

const input = (over: Partial<Parameters<typeof decideCiReady>[0]> = {}) => ({
  checks: [check()],
  hasCiHistory: true,
  judgedSha: "abc123",
  lastReportedSha: null,
  ...over,
});

describe("decideCiReady", () => {
  it("waits while a check on the judged sha is still running", () => {
    expect(
      decideCiReady(
        input({ checks: [check({ status: "in_progress", conclusion: null })] }),
      ),
    ).toEqual({ kind: "wait", reason: "ci_pending" });
  });

  it("waits as ci_not_started when a CI-running repo has no checks yet", () => {
    expect(decideCiReady(input({ checks: [] }))).toEqual({
      kind: "wait",
      reason: "ci_not_started",
    });
  });

  it("is ready when a repo that runs no CI has no checks", () => {
    expect(decideCiReady(input({ checks: [], hasCiHistory: false }))).toEqual({
      kind: "ready",
    });
  });

  it("waits when no commit on the pull request can be judged", () => {
    expect(decideCiReady(input({ judgedSha: null }))).toEqual({
      kind: "wait",
      reason: "no_judgeable_sha",
    });
  });

  it("is ready when every check on the judged sha passed", () => {
    expect(decideCiReady(input())).toEqual({ kind: "ready" });
  });

  it("blocks a fresh red sha with changes_requested naming the failed check", () => {
    expect(
      decideCiReady(
        input({
          checks: [
            check({
              name: "lint",
              conclusion: "failure",
              output: { title: "3 problems", summary: "no-unused-vars" },
            }),
          ],
        }),
      ),
    ).toEqual({
      kind: "blocked",
      reason: "ci_red",
      outcome: "changes_requested",
      feedback: {
        ci_feedback_sha: "abc123",
        ci_failed_checks: "lint",
        ci_failure_summary:
          "### lint (failure)\n\n3 problems\n\nno-unused-vars",
      },
    });
  });

  it("blocks with failed when the sha already reported red is still red", () => {
    expect(
      decideCiReady(
        input({
          checks: [check({ name: "lint", conclusion: "failure" })],
          lastReportedSha: "abc123",
        }),
      ),
    ).toMatchObject({
      kind: "blocked",
      reason: "ci_red_unchanged",
      outcome: "failed",
    });
  });

  it("names every failed check when more than one is red", () => {
    expect(
      decideCiReady(
        input({
          checks: [
            check({ name: "lint", conclusion: "failure" }),
            check({ name: "test:shared", conclusion: "timed_out" }),
          ],
        }),
      ),
    ).toMatchObject({ feedback: { ci_failed_checks: "lint, test:shared" } });
  });
});
