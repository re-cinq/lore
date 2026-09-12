import { describe, it, expect } from "vitest";
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  failureTail,
  summarizeFailedChecks,
} from "./check-runs.js";
import type { CheckRun, PullCommit } from "./pull-requests-port.js";

const check = (over: Partial<CheckRun> = {}): CheckRun => ({
  name: "test",
  status: "completed",
  conclusion: "success",
  ...over,
});

const commit = (over: Partial<PullCommit> = {}): PullCommit => ({
  sha: "aaa",
  message: "feat: a change",
  date: "2026-09-09T10:00:00Z",
  ...over,
});

describe("ciConclusionOf", () => {
  it("returns none when the ref has no check runs", () => {
    expect(ciConclusionOf([])).toBe("none");
  });

  it("returns pending when one run among successes is in_progress", () => {
    expect(
      ciConclusionOf([
        check(),
        check({ name: "lint", status: "in_progress", conclusion: null }),
      ]),
    ).toBe("pending");
  });

  it("returns failure when one completed run among successes is cancelled", () => {
    expect(
      ciConclusionOf([
        check(),
        check({ name: "lint", conclusion: "cancelled" }),
      ]),
    ).toBe("failure");
  });

  it("returns success when a completed run carries a null conclusion", () => {
    expect(ciConclusionOf([check({ conclusion: null })])).toBe("success");
  });
});

describe("externalCheckRuns", () => {
  it("drops lore/code-review and keeps test:shared", () => {
    expect(
      externalCheckRuns([
        check({ name: "lore/code-review" }),
        check({ name: "test:shared" }),
      ]).map((run) => run.name),
    ).toEqual(["test:shared"]);
  });
});

describe("summarizeFailedChecks", () => {
  it("names two checks sharing a name once, since two workflows can publish one", () => {
    expect(
      summarizeFailedChecks([
        check({ name: "build", conclusion: "failure" }),
        check({ name: "build", conclusion: "timed_out" }),
      ]).names,
    ).toEqual(["build"]);
  });

  it("gathers what both checks of one name reported into a single block", () => {
    expect(
      summarizeFailedChecks([
        check({
          name: "build",
          conclusion: "failure",
          output: { title: "ui", summary: null },
        }),
        check({
          name: "build",
          conclusion: "failure",
          output: { title: "api", summary: null },
        }),
      ]).summary,
    ).toBe("### build (failure)\n\nui\n\napi");
  });

  it("returns an empty summary when a failed check reported nothing, which is the ordinary case for an Actions job", () => {
    expect(
      summarizeFailedChecks([check({ name: "lint", conclusion: "failure" })]),
    ).toEqual({ names: ["lint"], summary: "" });
  });

  it("omits the checks that reported nothing while keeping the one that did", () => {
    expect(
      summarizeFailedChecks([
        check({ name: "build", conclusion: "failure" }),
        check({
          name: "lint",
          conclusion: "failure",
          output: { title: "3 problems", summary: null },
        }),
      ]).summary,
    ).toBe("### lint (failure)\n\n3 problems");
  });

  it("names only the failed checks, in the order given", () => {
    expect(
      summarizeFailedChecks([
        check({ name: "lint", conclusion: "failure" }),
        check({ name: "test:shared" }),
        check({ name: "build", conclusion: "timed_out" }),
      ]).names,
    ).toEqual(["lint", "build"]);
  });

  it("carries the output title and summary under the check name", () => {
    expect(
      summarizeFailedChecks([
        check({
          name: "lint",
          conclusion: "failure",
          output: { title: "3 problems", summary: "no-unused-vars in a.ts" },
        }),
      ]).summary,
    ).toBe("### lint (failure)\n\n3 problems\n\nno-unused-vars in a.ts");
  });

  it("cuts a summary past the cap with a truncation marker", () => {
    expect(
      summarizeFailedChecks(
        [
          check({
            name: "lint",
            conclusion: "failure",
            output: { title: null, summary: "x".repeat(200) },
          }),
        ],
        80,
      ).summary,
    ).toBe(`### lint (failure)\n\n${"x".repeat(60)}\n...(truncated)`);
  });

  it("returns no names and an empty summary when every check passed", () => {
    expect(summarizeFailedChecks([check()])).toEqual({
      names: [],
      summary: "",
    });
  });
});

describe("ciJudgedSha", () => {
  it("returns the commit before a head whose message skips CI", () => {
    expect(
      ciJudgedSha([
        commit({ sha: "aaa" }),
        commit({ sha: "bbb", message: "style: prettier [skip ci]" }),
      ]),
    ).toBe("aaa");
  });

  it("returns the head sha when the head carries no skip marker", () => {
    expect(ciJudgedSha([commit({ sha: "aaa" }), commit({ sha: "bbb" })])).toBe(
      "bbb",
    );
  });

  it("returns null when every commit message skips CI", () => {
    expect(
      ciJudgedSha([commit({ sha: "aaa", message: "chore [ci skip]" })]),
    ).toBe(null);
  });

  it("returns null for a pull request with no commits", () => {
    expect(ciJudgedSha([])).toBe(null);
  });

  it("skips a commit whose skip marker is upper case", () => {
    expect(
      ciJudgedSha([
        commit({ sha: "aaa" }),
        commit({ sha: "bbb", message: "wip [NO CI]" }),
      ]),
    ).toBe("aaa");
  });
});

const BOWMAN_UI_LINT_FAILURE_JOB_LOG = [
  "2026-09-10T15:19:24.9182696Z found 0 vulnerabilities",
  "2026-09-10T15:19:24.9810135Z ##[end-action id=__self.__run;outcome=success;conclusion=success;duration_ms=5329]",
  "2026-09-10T15:19:24.9853800Z ##[group]Run npm run lint",
  "2026-09-10T15:19:24.9889926Z shell: /usr/bin/bash -e {0}",
  "2026-09-10T15:19:24.9890197Z ##[endgroup]",
  "2026-09-10T15:19:25.0884201Z ",
  "2026-09-10T15:19:25.0884965Z > @re-cinq/bowman-ui@0.0.0 lint",
  "2026-09-10T15:19:25.0885477Z > eslint . --max-warnings 0",
  "2026-09-10T15:19:33.0739922Z ",
  "2026-09-10T15:19:33.0741174Z /home/runner/work/bowman-ui/bowman-ui/specs/bowman-ui-theming-tokens/spec.md",
  '2026-09-10T15:19:33.0771169Z ##[error]  6:1  error  Status "shipped" does not match this spec\'s test-link coverage — 54 of 57 testable statements carry a link',
  "2026-09-10T15:19:33.0778538Z ",
  "2026-09-10T15:19:33.0778881Z ✖ 1 problem (1 error, 0 warnings)",
  "2026-09-10T15:19:33.3498151Z ##[error]Process completed with exit code 1.",
  "2026-09-10T15:19:33.3661297Z Post job cleanup.",
].join("\n");

describe("failureTail", () => {
  it("returns what the failing step printed between its command header and its exit line", () => {
    expect(failureTail(BOWMAN_UI_LINT_FAILURE_JOB_LOG)).toEqual([
      "> @re-cinq/bowman-ui@0.0.0 lint",
      "> eslint . --max-warnings 0",
      "/home/runner/work/bowman-ui/bowman-ui/specs/bowman-ui-theming-tokens/spec.md",
      '6:1  error  Status "shipped" does not match this spec\'s test-link coverage — 54 of 57 testable statements carry a link',
      "✖ 1 problem (1 error, 0 warnings)",
    ]);
  });

  it("returns no lines when no step in the log exited non-zero", () => {
    expect(
      failureTail(
        "2026-09-10T15:19:24.9853800Z ##[group]Run npm run lint\n2026-09-10T15:19:24.9890197Z ##[endgroup]\n2026-09-10T15:19:25.0884965Z > eslint .",
      ),
    ).toEqual([]);
  });
});

describe("summarizeFailedChecks on an Actions job", () => {
  it("renders the failed step and what it printed when the job reported nothing itself", () => {
    expect(
      summarizeFailedChecks([
        check({
          name: "build-test",
          conclusion: "failure",
          output: { title: null, summary: null },
          jobFailure: {
            annotations: [],
            steps: ["Lint (--max-warnings 0)"],
            tail: [
              "specs/bowman-ui-theming-tokens/spec.md",
              '6:1  error  Status "shipped" does not match',
            ],
          },
        }),
      ]).summary,
    ).toBe(
      '### build-test (failure)\n\nFailed step: Lint (--max-warnings 0)\n\nspecs/bowman-ui-theming-tokens/spec.md\n6:1  error  Status "shipped" does not match',
    );
  });
});

describe("summarizeFailedChecks on an Actions job with annotations", () => {
  it("renders the failure annotations first, naming the file and line before the failed step and its output", () => {
    expect(
      summarizeFailedChecks([
        check({
          name: "format",
          conclusion: "failure",
          output: { title: null, summary: null },
          jobFailure: {
            annotations: [
              'specs/testing-standards/spec.md:7 Status "draft" does not match this spec\'s test-link coverage',
            ],
            steps: ["Prettier + eslint --fix"],
            tail: ["✖ 10540 problems (1 error, 10539 warnings)"],
          },
        }),
      ]).summary,
    ).toBe(
      '### format (failure)\n\nspecs/testing-standards/spec.md:7 Status "draft" does not match this spec\'s test-link coverage\n\nFailed step: Prettier + eslint --fix\n\n✖ 10540 problems (1 error, 10539 warnings)',
    );
  });
});
