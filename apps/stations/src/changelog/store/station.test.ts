import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { InMemoryChangelogWeeks } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-memory.js";
import { changelogStoreHandle } from "./station.js";

const WEEK = {
  repo: "re-cinq/lore",
  weekKey: "2026-W43",
  changes: [
    {
      kind: "pr",
      number: 7,
      title: "Show the week on the changelog",
      url: "https://github.com/re-cinq/lore/pull/7",
      people: ["alice"],
      at: "2026-10-21T10:00:00Z",
    },
  ],
};

function scene(files: Record<string, string>) {
  const weeks = new InMemoryChangelogWeeks();
  const tools: Tools = {
    read: (name) => Promise.resolve(Buffer.from(files[name] ?? "")),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
  const brief = {
    visitId: "0b0e6b1e-0000-4000-8000-000000000003",
    iteration: 1,
    needs: Object.fromEntries(Object.keys(files).map((name) => [name, name])),
  };

  return { handle: changelogStoreHandle(weeks), tools, brief, weeks };
}

const stored = (weeks: InMemoryChangelogWeeks) =>
  weeks.rows.map(({ writtenAt: _at, ...row }) => row);

describe("the changelog-store station", () => {
  it("stores re-cinq/lore's 2026-W43 with the agent's introduction", async () => {
    const { handle, tools, brief, weeks } = scene({
      changelog_week: JSON.stringify(WEEK),
      changelog_intro: "  The changelog shows the week.\n",
    });

    expect({
      report: await handle(brief, tools),
      rows: stored(weeks),
    }).toEqual({
      report: { outcome: "success" },
      rows: [{ ...WEEK, intro: "The changelog shows the week." }],
    });
  });

  it("stores the week without an introduction when the agent left none", async () => {
    const { handle, tools, brief, weeks } = scene({
      changelog_week: JSON.stringify(WEEK),
    });

    await handle(brief, tools);

    expect(stored(weeks)).toEqual([{ ...WEEK, intro: "" }]);
  });

  it("reports failed and stores nothing when the week file is not a week", async () => {
    const { handle, tools, brief, weeks } = scene({
      changelog_week: JSON.stringify({ repo: "re-cinq/lore" }),
    });

    expect({
      outcome: (await handle(brief, tools)).outcome,
      rows: weeks.rows,
    }).toEqual({ outcome: "failed", rows: [] });
  });
});
