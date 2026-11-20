import { describe, expect, it } from "vitest";
import { InMemoryChangelogReleases } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-memory.js";
import { releaseTick, type ReleaseTickDeps } from "./release-tick.js";

const FRIDAY_1015_BERLIN = new Date("2026-11-20T09:15:00Z");
const FRIDAY_0700_BERLIN = new Date("2026-11-20T06:00:00Z");
const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const FRIDAY_AT_NINE = {
  release: {
    enabled: true,
    days: [5],
    time: "09:00",
    timezone: "Europe/Berlin",
  },
};

type Settings = Record<string, unknown> | null;

function scene(
  repos: Record<string, Settings>,
  { now = FRIDAY_1015_BERLIN, headFails = [] as string[] } = {},
) {
  const started: Array<{ line: string; values: Record<string, string> }> = [];
  const releases = new InMemoryChangelogReleases();
  const deps: ReleaseTickDeps = {
    repoSettings: () =>
      Promise.resolve(
        Object.entries(repos).map(([full_name, settings]) => ({
          full_name,
          settings,
        })),
      ),
    releases,
    headSha: (repo) =>
      headFails.includes(repo)
        ? Promise.reject(new Error("github down"))
        : Promise.resolve(HEAD),
    now: () => now,
    floor: {
      lines: {
        start: (line, starting) => {
          started.push({
            line,
            values: Object.fromEntries(
              Object.entries(starting.startItems ?? {}).map(
                ([name, startItem]) => [
                  name,
                  (startItem as { ref: string }).ref,
                ],
              ),
            ),
          });

          return Promise.resolve({
            run: { id: "run-new" },
            joined: false,
          } as never);
        },
      },
    },
  };

  return {
    deps,
    started,
    releases,
    at: (now: Date) => ({ ...deps, now: () => now }),
  };
}

describe("the release tick", () => {
  it("starts release for re-cinq/lore-security keyed with head a1b2c3d on Friday 10:15 Berlin, a day set for 09:00", async () => {
    const { deps, started } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });

    expect({
      summary: await releaseTick(deps),
      started,
    }).toEqual({
      summary: "started 1 of 1 due repo(s)",
      started: [
        {
          line: "release",
          values: {
            release_key: `re-cinq/lore-security:${HEAD}`,
            release_repo: "re-cinq/lore-security",
          },
        },
      ],
    });
  });

  it("marks Friday 09:15Z as the scheduled attempt of the repo it started", async () => {
    const { deps, releases } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });

    await releaseTick(deps);

    expect(
      await releases.lastScheduledAttempt("re-cinq/lore-security"),
    ).toEqual(FRIDAY_1015_BERLIN);
  });

  it("starts the repo once on Friday when a second tick comes 15 minutes later and the first run ended empty with no release stored", async () => {
    const { deps, started, at } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });

    await releaseTick(deps);
    await releaseTick(at(new Date("2026-11-20T09:30:00Z")));
    await releaseTick(at(new Date("2026-11-20T21:00:00Z")));

    expect(started.map((entry) => entry.values.release_repo)).toEqual([
      "re-cinq/lore-security",
    ]);
  });

  it("starts the repo again on the next Friday, a week after its last attempt", async () => {
    const { deps, started, at } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });

    await releaseTick(deps);
    await releaseTick(at(new Date("2026-11-27T09:15:00Z")));

    expect(started.map((entry) => entry.values.release_repo)).toEqual([
      "re-cinq/lore-security",
      "re-cinq/lore-security",
    ]);
  });

  it("starts only re-cinq/due, not re-cinq/early whose 09:00 Berlin has not come at 07:00, nor re-cinq/disabled", async () => {
    const early = { release: { ...FRIDAY_AT_NINE.release, time: "12:00" } };
    const disabled = { release: { ...FRIDAY_AT_NINE.release, enabled: false } };
    const { deps, started } = scene({
      "re-cinq/due": FRIDAY_AT_NINE,
      "re-cinq/early": early,
      "re-cinq/disabled": disabled,
      "re-cinq/no-release-block": { auto_review: true },
      "re-cinq/no-settings": null,
    });

    await releaseTick(deps);

    expect(started.map((entry) => entry.values.release_repo)).toEqual([
      "re-cinq/due",
    ]);
  });

  it("starts nothing on Friday 08:00 Berlin, an hour before the time set for the repo", async () => {
    const { deps, started } = scene(
      { "re-cinq/lore-security": FRIDAY_AT_NINE },
      { now: FRIDAY_0700_BERLIN },
    );

    expect({
      summary: await releaseTick(deps),
      started,
    }).toEqual({ summary: "started 0 of 0 due repo(s)", started: [] });
  });

  it("starts nothing when a release was stored at 09:00Z the same Friday, an on-demand release counting as the run of that Friday", async () => {
    const { deps, started, releases } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });

    await releases.upsert({
      repo: "re-cinq/lore-security",
      version: "v1.1.0",
      previousTag: "v1.0.0",
      sha: HEAD,
      bump: "minor",
      rangeFrom: null,
      rangeTo: new Date("2026-11-20T09:00:00Z"),
      summary: "",
      changes: [],
      releaseUrl: null,
      publishedTo: null,
    });
    await releaseTick(deps);

    expect(started).toEqual([]);
  });

  it("starts re-cinq/otto when the head of re-cinq/lore-security cannot be read, and counts 1 of 2", async () => {
    const { deps, started } = scene(
      {
        "re-cinq/lore-security": FRIDAY_AT_NINE,
        "re-cinq/otto": FRIDAY_AT_NINE,
      },
      { headFails: ["re-cinq/lore-security"] },
    );

    expect({
      summary: await releaseTick(deps),
      repos: started.map((entry) => entry.values.release_repo),
    }).toEqual({
      summary: "started 1 of 2 due repo(s)",
      repos: ["re-cinq/otto"],
    });
  });

  it("marks nothing for re-cinq/lore-security when its head cannot be read, and starts it on the tick 15 minutes later", async () => {
    const { deps, started, releases, at } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });
    const unreadable = {
      ...deps,
      headSha: () => Promise.reject(new Error("github down")),
    };

    await releaseTick(unreadable);
    const markedAfterFailure = await releases.lastScheduledAttempt(
      "re-cinq/lore-security",
    );

    await releaseTick(at(new Date("2026-11-20T09:30:00Z")));

    expect({
      markedAfterFailure,
      repos: started.map((entry) => entry.values.release_repo),
    }).toEqual({
      markedAfterFailure: null,
      repos: ["re-cinq/lore-security"],
    });
  });

  it("marks nothing for re-cinq/lore-security when the floor refuses its start, and starts it on the tick 15 minutes later", async () => {
    const { deps, started, releases, at } = scene({
      "re-cinq/lore-security": FRIDAY_AT_NINE,
    });
    const refusing = {
      ...deps,
      floor: {
        lines: { start: () => Promise.reject(new Error("floor down")) },
      },
    };

    await releaseTick(refusing);
    const markedAfterFailure = await releases.lastScheduledAttempt(
      "re-cinq/lore-security",
    );

    await releaseTick(at(new Date("2026-11-20T09:30:00Z")));

    expect({
      markedAfterFailure,
      repos: started.map((entry) => entry.values.release_repo),
    }).toEqual({
      markedAfterFailure: null,
      repos: ["re-cinq/lore-security"],
    });
  });
});
