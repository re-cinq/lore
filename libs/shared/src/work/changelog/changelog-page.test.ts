import { describe, it, expect } from "vitest";
import { mergedPr } from "../digest/fixtures.js";
import type { ChangelogWeek } from "../../domain/models/changelog-week.js";
import { changelogPage, type ChangelogPageDeps } from "./changelog-page.js";

const THURSDAY_W43 = new Date("2026-10-22T12:00:00Z");

const storedW42: ChangelogWeek = {
  repo: "re-cinq/lore",
  weekKey: "2026-W42",
  intro: "Utopia now holds the repo's git history.",
  changes: [
    {
      kind: "pr",
      number: 3000,
      title: "Mirror commits",
      url: "https://gh/pr/3000",
      people: ["gedaiu"],
      at: "2026-10-14T10:00:00Z",
    },
  ],
  writtenAt: new Date("2026-10-19T06:00:00Z"),
};

function deps(over: Partial<ChangelogPageDeps> = {}) {
  const asked: unknown[] = [];
  const all: ChangelogPageDeps = {
    now: () => THURSDAY_W43,
    stored: (query) => {
      asked.push({ stored: query });

      return Promise.resolve([storedW42]);
    },
    closedWork: (since) => {
      asked.push({ since });

      return Promise.resolve({
        merged: [
          mergedPr({ number: 3055, mergedAt: "2026-10-21T10:00:00Z" }),
          mergedPr({ number: 2990, mergedAt: "2026-10-07T10:00:00Z" }),
        ],
        closed: [],
      });
    },
    ...over,
  };

  return { all, asked };
}

const summary = (page: Awaited<ReturnType<typeof changelogPage>>) =>
  page.weeks.map((week) => ({
    weekKey: week.weekKey,
    current: week.current,
    intro: week.intro,
    numbers: week.changes.map((change) => change.number),
  }));

describe("changelogPage", () => {
  it("leads with the current week read live, then stored 2026-W42, then 2026-W41 read live", async () => {
    const { all } = deps();
    const page = await changelogPage({ limit: 3 }, all);

    expect({ weeks: summary(page), next: page.next }).toEqual({
      weeks: [
        { weekKey: "2026-W43", current: true, intro: null, numbers: [3055] },
        {
          weekKey: "2026-W42",
          current: false,
          intro: "Utopia now holds the repo's git history.",
          numbers: [3000],
        },
        { weekKey: "2026-W41", current: false, intro: null, numbers: [2990] },
      ],
      next: "2026-W41",
    });
  });

  it("reads GitHub once, from the Monday of the oldest week it has no row for", async () => {
    const { all, asked } = deps();

    await changelogPage({ limit: 3 }, all);

    expect(asked).toEqual([
      { stored: { limit: 3 } },
      { since: "2026-10-05T00:00:00.000Z" },
    ]);
  });

  it("starts the page before 2026-W43 at 2026-W42 and reads no GitHub when every week is stored", async () => {
    const { all, asked } = deps();
    const page = await changelogPage({ before: "2026-W43", limit: 1 }, all);

    expect({ weeks: summary(page), asked }).toEqual({
      weeks: [
        {
          weekKey: "2026-W42",
          current: false,
          intro: "Utopia now holds the repo's git history.",
          numbers: [3000],
        },
      ],
      asked: [{ stored: { before: "2026-W43", limit: 1 } }],
    });
  });

  it("answers no next page when a page holds no change at all", async () => {
    const { all } = deps({
      stored: () => Promise.resolve([]),
      closedWork: () => Promise.resolve({ merged: [], closed: [] }),
    });

    expect(
      (await changelogPage({ before: "2020-W10", limit: 2 }, all)).next,
    ).toBe(null);
  });

  it("answers no next page when the only week is stored empty, with no introduction", async () => {
    const { all } = deps({
      stored: () => Promise.resolve([{ ...storedW42, intro: "", changes: [] }]),
    });
    const page = await changelogPage({ before: "2026-W43", limit: 1 }, all);

    expect({ intro: page.weeks[0]?.intro, next: page.next }).toEqual({
      intro: null,
      next: null,
    });
  });
});
