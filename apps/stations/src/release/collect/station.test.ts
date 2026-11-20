import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import {
  releaseCollectHandle,
  NOT_A_RELEASE,
  type ReleaseCollectDeps,
} from "./station.js";

const PR_7 = {
  repo: "re-cinq/lore",
  number: 7,
  title: "Show the release on the changelog",
  branch: "feat/release",
  state: "merged" as const,
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/7",
  author: "alice",
  mergedAt: "2026-11-10T10:00:00Z",
};

const HEAD = { sha: "bbb222", committedAt: "2026-11-20T09:30:00Z" };
const TAGGED = { sha: "aaa111", committedAt: "2026-11-02T08:00:00Z" };

function scene(over: Partial<ReleaseCollectDeps> = {}) {
  const produced: Record<string, string> = {};
  const asked: unknown[] = [];
  const tools: Tools = {
    read: () => Promise.resolve(Buffer.from("")),
    produce: (name, bytes) => {
      produced[name] = bytes.toString("utf8");

      return Promise.resolve();
    },
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const deps: ReleaseCollectDeps = {
    head: () => Promise.resolve(HEAD),
    tags: () => Promise.resolve([{ name: "v1.2.0", sha: TAGGED.sha }]),
    commit: () => Promise.resolve(TAGGED),
    closedWork: (repo, bounds) => {
      asked.push({ repo, bounds });

      return Promise.resolve({ merged: [PR_7], closed: [] });
    },
    ...over,
  };

  return { handle: releaseCollectHandle(deps), tools, produced, asked };
}

const brief = (needs: Record<string, string>) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000003",
  iteration: 1,
  needs,
});

const NEEDS = { release_repo: "re-cinq/lore" };

describe("the release-collect station", () => {
  it("pins bbb222, reads from the v1.2.0 commit time and produces the values and the changes file with pull request 7", async () => {
    const { handle, tools, produced, asked } = scene();
    const report = await handle(brief(NEEDS), tools);

    expect({
      report,
      asked,
      file: JSON.parse(produced.release_changes ?? "{}"),
    }).toMatchObject({
      report: {
        outcome: "success",
        produced: {
          release_sha: "bbb222",
          previous_tag: "v1.2.0",
          range_from: "2026-11-02T08:00:00.000Z",
          range_to: "2026-11-20T09:30:00.000Z",
        },
      },
      asked: [
        { repo: "re-cinq/lore", bounds: { from: "2026-11-02T08:00:00Z" } },
      ],
      file: {
        repo: "re-cinq/lore",
        previous_tag: "v1.2.0",
        sha: "bbb222",
        changes: [{ kind: "pr", number: 7, people: ["alice"] }],
      },
    });
  });

  it("produces no previous_tag and no range_from for a repo with no tag, reading all merged work", async () => {
    const { handle, tools, produced, asked } = scene({
      tags: () => Promise.resolve([]),
    });
    const report = await handle(brief(NEEDS), tools);

    expect({
      report,
      asked,
      file: JSON.parse(produced.release_changes ?? "{}"),
    }).toMatchObject({
      report: {
        outcome: "success",
        produced: {
          release_sha: "bbb222",
          range_to: "2026-11-20T09:30:00.000Z",
        },
      },
      asked: [{ bounds: { from: "1970-01-01T00:00:00.000Z" } }],
      file: { previous_tag: null, range_from: null, sha: "bbb222" },
    });
    expect(report.produced).not.toHaveProperty("previous_tag");
    expect(report.produced).not.toHaveProperty("range_from");
  });

  it("reports empty and produces nothing when v1.2.0 already sits on bbb222", async () => {
    const { handle, tools, produced, asked } = scene({
      tags: () => Promise.resolve([{ name: "v1.2.0", sha: HEAD.sha }]),
    });

    expect({
      report: await handle(brief(NEEDS), tools),
      produced,
      asked,
    }).toEqual({ report: { outcome: "empty" }, produced: {}, asked: [] });
  });

  it("reports empty and produces nothing when no pull request merged since v1.2.0", async () => {
    const { handle, tools, produced } = scene({
      closedWork: () => Promise.resolve({ merged: [], closed: [] }),
    });

    expect({ report: await handle(brief(NEEDS), tools), produced }).toEqual({
      report: { outcome: "empty" },
      produced: {},
    });
  });

  it("reports empty when the only pull request merged after the head commit", async () => {
    const { handle, tools } = scene({
      closedWork: () =>
        Promise.resolve({
          merged: [{ ...PR_7, mergedAt: "2026-11-21T10:00:00Z" }],
          closed: [],
        }),
    });

    expect(await handle(brief(NEEDS), tools)).toEqual({ outcome: "empty" });
  });

  it("reports failed with the GitHub error when re-cinq/lore cannot be read", async () => {
    const { handle, tools, produced } = scene({
      head: () => Promise.reject(new Error("GitHub API 502")),
    });

    expect({ report: await handle(brief(NEEDS), tools), produced }).toEqual({
      report: { outcome: "failed", error: "GitHub API 502" },
      produced: {},
    });
  });

  it("reports failed when the run carries no release_repo", async () => {
    const { handle, tools } = scene();

    expect(await handle(brief({}), tools)).toEqual({
      outcome: "failed",
      error: NOT_A_RELEASE,
    });
  });
});
