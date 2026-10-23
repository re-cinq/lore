import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import {
  changelogCollectHandle,
  NOT_A_WEEK,
  type ChangelogCollectDeps,
} from "./station.js";

const PR_7 = {
  repo: "re-cinq/lore",
  number: 7,
  title: "Show the week on the changelog",
  branch: "feat/week",
  state: "merged" as const,
  labels: [],
  url: "https://github.com/re-cinq/lore/pull/7",
  author: "alice",
  mergedAt: "2026-10-21T10:00:00Z",
};

function scene(over: Partial<ChangelogCollectDeps> = {}) {
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
  const deps: ChangelogCollectDeps = {
    closedWork: (repo, bounds) => {
      asked.push({ repo, bounds });

      return Promise.resolve({ merged: [PR_7], closed: [] });
    },
    ...over,
  };

  return { handle: changelogCollectHandle(deps), tools, produced, asked };
}

const brief = (needs: Record<string, string>) => ({
  visitId: "0b0e6b1e-0000-4000-8000-000000000002",
  iteration: 1,
  needs,
});

const NEEDS = { changelog_repo: "re-cinq/lore", week_key: "2026-W43" };

describe("the changelog-collect station", () => {
  it("reads re-cinq/lore for 2026-10-19 to 2026-10-26 and produces the week with pull request 7", async () => {
    const { handle, tools, produced, asked } = scene();
    const report = await handle(brief(NEEDS), tools);

    expect({
      report,
      asked,
      week: JSON.parse(produced.changelog_week ?? "{}"),
    }).toMatchObject({
      report: { outcome: "success" },
      asked: [
        {
          repo: "re-cinq/lore",
          bounds: {
            from: "2026-10-19T00:00:00.000Z",
            to: "2026-10-26T00:00:00.000Z",
          },
        },
      ],
      week: {
        repo: "re-cinq/lore",
        weekKey: "2026-W43",
        changes: [{ kind: "pr", number: 7, people: ["alice"] }],
      },
    });
  });

  it("reports empty, with the empty week produced, when nothing merged or closed", async () => {
    const { handle, tools, produced } = scene({
      closedWork: () => Promise.resolve({ merged: [], closed: [] }),
    });

    expect({
      report: await handle(brief(NEEDS), tools),
      changes: JSON.parse(produced.changelog_week ?? "{}").changes,
    }).toEqual({ report: { outcome: "empty" }, changes: [] });
  });

  it("reports failed with GitHub's reason when re-cinq/lore cannot be read", async () => {
    const { handle, tools } = scene({
      closedWork: () => Promise.reject(new Error("GitHub API 502")),
    });

    expect(await handle(brief(NEEDS), tools)).toEqual({
      outcome: "failed",
      error: "GitHub API 502",
    });
  });

  it("reports failed when the run carries no week_key", async () => {
    const { handle, tools } = scene();

    expect(
      await handle(brief({ changelog_repo: "re-cinq/lore" }), tools),
    ).toEqual({ outcome: "failed", error: NOT_A_WEEK });
  });
});
