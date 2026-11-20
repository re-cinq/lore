import { describe, expect, it } from "vitest";
import { InMemoryChangelogReleases } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-memory.js";
import { InMemoryChangelogWeeks } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-memory.js";
import { changelogTick, type ChangelogTickDeps } from "./changelog-tick.js";

const MONDAY_0600 = new Date("2026-10-26T06:00:00Z");

function scene(
  repos: string[],
  refusing: string[] = [],
  settingsOf: Record<string, Record<string, unknown>> = {},
) {
  const started: Array<{ line: string; repo: unknown; values: unknown }> = [];
  const weeks = new InMemoryChangelogWeeks();
  const releases = new InMemoryChangelogReleases();
  const deps: ChangelogTickDeps = {
    repoSettings: () =>
      Promise.resolve(
        repos.map((full_name) => ({
          full_name,
          settings: settingsOf[full_name] ?? null,
        })),
      ),
    weeks,
    releases,
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

  return { deps, started, weeks, releases };
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

  it("starts nothing for re-cinq/lore-security, which has release.enabled, and still starts re-cinq/otto", async () => {
    const { deps, started } = scene(
      ["re-cinq/lore-security", "re-cinq/otto"],
      [],
      { "re-cinq/lore-security": { release: { enabled: true } } },
    );

    await changelogTick({}, deps);

    expect(
      started.map(
        (s) => (s.values as { changelog_repo: string }).changelog_repo,
      ),
    ).toEqual(["re-cinq/otto"]);
  });

  it("starts nothing for re-cinq/lore-security, which has a stored release v1.0.0 and release.enabled off", async () => {
    const { deps, started, releases } = scene(["re-cinq/lore-security"], [], {
      "re-cinq/lore-security": { release: { enabled: false } },
    });

    await releases.upsert({
      repo: "re-cinq/lore-security",
      version: "v1.0.0",
      previousTag: null,
      sha: "a".repeat(40),
      bump: "minor",
      rangeFrom: null,
      rangeTo: new Date("2026-11-20T09:00:00Z"),
      summary: "",
      changes: [],
      releaseUrl: null,
      publishedTo: null,
    });

    expect({
      summary: await changelogTick({}, deps),
      started: started.length,
    }).toEqual({
      summary: "started 0 of 0 week(s) without a changelog",
      started: 0,
    });
  });

  it("starts re-cinq/otto, whose settings carry no release block and which has no stored release, as before", async () => {
    const { deps, started } = scene(["re-cinq/otto"], [], {
      "re-cinq/otto": { auto_review: true },
    });

    await changelogTick({}, deps);

    expect(
      started.map(
        (s) => (s.values as { changelog_repo: string }).changelog_repo,
      ),
    ).toEqual(["re-cinq/otto"]);
  });
});
