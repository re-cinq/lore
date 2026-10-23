import { describe, expect, it } from "vitest";
import { InMemoryChangelogWeeks } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-memory.js";
import { changelogTick, type ChangelogTickDeps } from "./changelog-tick.js";

const MONDAY_0600 = new Date("2026-10-26T06:00:00Z");

function scene(repos: string[], refusing: string[] = []) {
  const started: Array<{ line: string; repo: unknown; values: unknown }> = [];
  const weeks = new InMemoryChangelogWeeks();
  const deps: ChangelogTickDeps = {
    repos: () => Promise.resolve(repos),
    weeks,
    now: () => MONDAY_0600,
    floor: {
      lines: {
        start: (line, starting) => {
          const values = Object.fromEntries(
            Object.entries(starting.startItems ?? {}).map(([name, started]) => [
              name,
              (started as { ref: string }).ref,
            ]),
          );

          if (refusing.includes(values.changelog_repo as string)) {
            return Promise.reject(new Error("floor down"));
          }
          started.push({ line, repo: starting.repo, values });

          return Promise.resolve({
            run: { id: "run-new" },
            joined: false,
          } as never);
        },
      },
    },
  };

  return { deps, started, weeks };
}

describe("the changelog tick", () => {
  it("starts weekly-changelog for re-cinq/lore's 2026-W43 on Monday 2026-10-26, keyed re-cinq/lore:2026-W43", async () => {
    const { deps, started } = scene(["re-cinq/lore"]);

    expect({
      summary: await changelogTick({}, deps),
      started: started.map((s) => ({ line: s.line, values: s.values })),
    }).toEqual({
      summary: "started 1 of 1 week(s) without a changelog",
      started: [
        {
          line: "weekly-changelog",
          values: {
            changelog_key: "re-cinq/lore:2026-W43",
            changelog_repo: "re-cinq/lore",
            week_key: "2026-W43",
          },
        },
      ],
    });
  });

  it("starts only 2026-W42 when asked for 2 weeks and 2026-W43 is already written", async () => {
    const { deps, started, weeks } = scene(["re-cinq/lore"]);

    await weeks.upsert({
      repo: "re-cinq/lore",
      weekKey: "2026-W43",
      intro: "",
      changes: [],
    });
    await changelogTick({ weeks: 2 }, deps);

    expect(
      started.map((s) => (s.values as { week_key: string }).week_key),
    ).toEqual(["2026-W42"]);
  });

  it("starts re-cinq/otto when the floor refuses re-cinq/lore, and counts 1 of 2", async () => {
    const { deps, started } = scene(
      ["re-cinq/lore", "re-cinq/otto"],
      ["re-cinq/lore"],
    );

    expect({
      summary: await changelogTick({}, deps),
      repos: started.map(
        (s) => (s.values as { changelog_repo: string }).changelog_repo,
      ),
    }).toEqual({
      summary: "started 1 of 2 week(s) without a changelog",
      repos: ["re-cinq/otto"],
    });
  });

  it("narrows to params.repo and caps weeks at 12", async () => {
    const { deps, started } = scene(["re-cinq/lore", "re-cinq/otto"]);

    await changelogTick({ repo: "re-cinq/otto", weeks: 40 }, deps);

    expect({
      count: started.length,
      repos: [
        ...new Set(
          started.map(
            (s) => (s.values as { changelog_repo: string }).changelog_repo,
          ),
        ),
      ],
    }).toEqual({ count: 12, repos: ["re-cinq/otto"] });
  });
});
