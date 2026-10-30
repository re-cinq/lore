import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  enabledTriageRepos,
  issueTriageTick,
  type IssueTriageTickDeps,
} from "./issue-triage-tick.js";

function scene(opts: {
  issues?: Record<
    string,
    Array<{ url: string; number: number; labels?: string[] }>
  >;
  openRuns?: Record<string, Array<{ issueNumber: number; atGate: boolean }>>;
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
    openRuns: (repo: string) =>
      Promise.resolve((opts.openRuns ?? {})[repo] ?? []),
    defaultBranch: () => Promise.resolve("main"),
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
  it("starts the run on github.com/acme/widgets@main, the checkout decompose reads", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
        ],
      },
    });

    await issueTriageTick({}, deps);

    expect(started[0]?.startItems.target).toMatchObject({
      kind: "git",
      ref: "github.com/acme/widgets@main",
    });
  });

  it("sends exactly the start items the issue-triage line declares, repo among them, so the floor accepts the run", async () => {
    const line = parse(
      readFileSync(
        new URL(
          "../../../../../libs/assembly-lines/src/floor-pipelines/issue-triage.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { line: { args: Record<string, unknown> } };
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
        ],
      },
    });

    await issueTriageTick({}, deps);

    expect(Object.keys(started[0]?.startItems ?? {}).sort()).toEqual(
      Object.keys(line.line.args).sort(),
    );
  });

  it("starts #1, labelled only triage: needs-triage, and leaves #2, which triage already labelled reproduced", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          {
            url: "https://github.com/acme/widgets/issues/1",
            number: 1,
            labels: ["bug", "triage: needs-triage"],
          },
          {
            url: "https://github.com/acme/widgets/issues/2",
            number: 2,
            labels: ["triage: needs-triage", "triage: reproduced"],
          },
        ],
      },
    });

    await issueTriageTick({}, deps);

    expect(started.map((s) => s.startItems.issue_number)).toMatchObject([
      { ref: "1" },
    ]);
  });

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
      openRuns: {
        "acme/widgets": [
          { issueNumber: 7, atGate: false },
          { issueNumber: 8, atGate: false },
        ],
      },
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
  it("starts #3 and leaves #1 and #2, whose runs wait at the human gate, without counting them against a cap of 1", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
          { url: "https://github.com/acme/widgets/issues/2", number: 2 },
          { url: "https://github.com/acme/widgets/issues/3", number: 3 },
        ],
      },
      openRuns: {
        "acme/widgets": [
          { issueNumber: 1, atGate: true },
          { issueNumber: 2, atGate: true },
        ],
      },
      cap: 1,
    });

    await issueTriageTick({}, deps);

    expect(started.map((s) => s.startItems.issue_number)).toMatchObject([
      { ref: "3" },
    ]);
  });

  it("starts #2 and leaves #1, whose run is still working", async () => {
    const { deps, started } = scene({
      issues: {
        "acme/widgets": [
          { url: "https://github.com/acme/widgets/issues/1", number: 1 },
          { url: "https://github.com/acme/widgets/issues/2", number: 2 },
        ],
      },
      openRuns: { "acme/widgets": [{ issueNumber: 1, atGate: false }] },
      cap: 3,
    });

    await issueTriageTick({}, deps);

    expect(started.map((s) => s.startItems.issue_number)).toMatchObject([
      { ref: "2" },
    ]);
  });
});

describe("enabledTriageRepos", () => {
  it("keeps a repo with no issue_triage block and drops one switched off", () => {
    expect(
      enabledTriageRepos([
        { full_name: "acme/widgets", settings: null },
        {
          full_name: "acme/gadgets",
          settings: { issue_triage: { enabled: false } },
        },
        {
          full_name: "acme/gizmos",
          settings: { issue_triage: { enabled: true } },
        },
      ]),
    ).toEqual(["acme/widgets", "acme/gizmos"]);
  });
});
