import { describe, expect, it } from "vitest";
import {
  issueTriageTick,
  type IssueTriageTickDeps,
} from "./issue-triage-tick.js";

function scene(opts: {
  issues?: Record<string, Array<{ url: string; number: number }>>;
  running?: Record<string, number>;
  cap?: number;
  repos?: string[];
}) {
  const started: Array<{
    line: string;
    repo: string;
    startItems: Record<string, unknown>;
  }> = [];

  const deps = {
    repos: () => Promise.resolve(opts.repos ?? ["acme/widgets"]),
    needsTriageIssues: (repo: string) =>
      Promise.resolve((opts.issues ?? {})[repo] ?? []),
    runningCount: (repo: string) =>
      Promise.resolve((opts.running ?? {})[repo] ?? 0),
    cap: opts.cap ?? 3,
    floor: {
      start: (
        line: string,
        starting: { repo: string; startItems: Record<string, unknown> },
      ) => {
        started.push({ line, ...starting });

        return Promise.resolve({
          run: { id: `run-${started.length}` },
          joined: false,
        });
      },
    },
  } as unknown as IssueTriageTickDeps;

  return { deps, started };
}

describe("the issue-triage-tick sweep on the external floor", () => {
  it("starts a floor run per qualifying issue, oldest first, each run independently", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
          { url: "https://github.com/acme/widgets/issues/2", number: 2 },
        ],
      },
    });

    await issueTriageTick({}, deps);

    expect(started).toHaveLength(2);
    expect(started.map((s) => s.line)).toEqual([
      "issue-triage",
      "issue-triage",
    ]);
    expect(started.map((s) => s.startItems)).toMatchObject([
      {
        issue_url: expect.objectContaining({
          ref: "https://github.com/acme/widgets/issues/1",
        }),
      },
      {
        issue_url: expect.objectContaining({
          ref: "https://github.com/acme/widgets/issues/2",
        }),
      },
    ]);
  });

  it("respects the per-repo concurrency cap: starts only as many runs as the remaining capacity allows", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
          { url: "https://github.com/acme/widgets/issues/2", number: 2 },
          { url: "https://github.com/acme/widgets/issues/3", number: 3 },
        ],
      },
      running: { "acme/widgets": 2 },
      cap: 3,
    });

    await issueTriageTick({}, deps);

    expect(started).toHaveLength(1);
    expect(started[0].startItems).toMatchObject({
      issue_url: expect.objectContaining({
        ref: "https://github.com/acme/widgets/issues/1",
      }),
    });
  });
});
