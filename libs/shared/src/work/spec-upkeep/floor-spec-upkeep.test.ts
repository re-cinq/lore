import { describe, expect, it } from "vitest";
import {
  planRun,
  recordedPlanFloor,
} from "../../outbound/floor/recorded-plan-floor.js";
import {
  enabledUpkeepRepos,
  SPEC_UPKEEP_LINE,
  specUpkeepTick,
  upkeepBranch,
  type UpkeepTickDeps,
} from "./floor-spec-upkeep.js";

const MONDAY = new Date("2026-10-05T10:00:00.000Z");

function scene(openBranches: Record<string, string[]> = {}) {
  const recorded = recordedPlanFloor();
  const deps: UpkeepTickDeps = {
    floor: recorded.floor,
    repos: () => Promise.resolve(["acme/widgets", "acme/gears"]),
    openPrBranches: (repo) => Promise.resolve(openBranches[repo] ?? []),
    now: () => MONDAY,
  };
  const started = () =>
    recorded.requests.filter(({ path }) => path.endsWith("/start"));

  return { deps, started };
}

describe("enabledUpkeepRepos", () => {
  it("keeps acme/a with no spec_upkeep block and acme/c switched on, drops acme/b switched off, sorted", () => {
    expect(
      enabledUpkeepRepos([
        { full_name: "acme/c", settings: { spec_upkeep: { enabled: true } } },
        { full_name: "acme/b", settings: { spec_upkeep: { enabled: false } } },
        { full_name: "acme/a", settings: {} },
      ]),
    ).toEqual(["acme/a", "acme/c"]);
  });
});

describe("upkeepBranch", () => {
  it("names the branch lore/spec-upkeep/2026-10-05 for a run on 5 October 2026", () => {
    expect(upkeepBranch(MONDAY)).toBe("lore/spec-upkeep/2026-10-05");
  });
});

describe("specUpkeepTick", () => {
  it("starts one spec-upkeep run per repository, on that day's branch and keyed on the day", async () => {
    const { deps, started } = scene();

    const summary = await specUpkeepTick({}, deps);

    expect(started().map((request) => request.body)).toEqual([
      {
        repo: "github.com/acme/widgets",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/acme/widgets@lore/spec-upkeep/2026-10-05",
            by: "lore",
          },
          upkeep: { kind: "value", ref: "2026-10-05", by: "lore" },
        },
      },
      {
        repo: "github.com/acme/gears",
        startItems: {
          repo: {
            kind: "git",
            ref: "github.com/acme/gears@lore/spec-upkeep/2026-10-05",
            by: "lore",
          },
          upkeep: { kind: "value", ref: "2026-10-05", by: "lore" },
        },
      },
    ]);
    expect(summary).toBe("spec upkeep: started 2, skipped 0, failed 0");
  });

  it("skips acme/widgets while an earlier upkeep pull request is still open there", async () => {
    const { deps, started } = scene({
      "acme/widgets": ["feat/x", "lore/spec-upkeep/2026-09-28"],
    });

    const summary = await specUpkeepTick({}, deps);

    expect(started().map((request) => request.path)).toEqual([
      "/assembly-lines/spec-upkeep/start",
    ]);
    expect(summary).toBe("spec upkeep: started 1, skipped 1, failed 0");
  });

  it("starts only acme/gears when the tick names that repository", async () => {
    const { deps, started } = scene();

    await specUpkeepTick({ repo: "acme/gears" }, deps);

    expect(started().map((request) => request.body)).toMatchObject([
      { repo: "github.com/acme/gears" },
    ]);
  });

  it("counts a repository whose pull requests cannot be read as failed and still starts the rest", async () => {
    const { deps } = scene();

    const summary = await specUpkeepTick(
      {},
      {
        ...deps,
        openPrBranches: (repo) =>
          repo === "acme/widgets"
            ? Promise.reject(new Error("GitHub 502"))
            : Promise.resolve([]),
      },
    );

    expect(summary).toBe("spec upkeep: started 1, skipped 0, failed 1");
  });

  it("starts repositories that have never run, then the one run longest ago, before repositories that ran more recently", async () => {
    const recorded = recordedPlanFloor({
      runs: [
        planRun({
          lineId: SPEC_UPKEEP_LINE,
          repo: "github.com/acme/repo-00",
          createdAt: "2026-09-28T10:00:00.000Z",
        }),
        planRun({
          lineId: SPEC_UPKEEP_LINE,
          repo: "github.com/acme/repo-00",
          createdAt: "2026-09-14T10:00:00.000Z",
        }),
        planRun({
          lineId: SPEC_UPKEEP_LINE,
          repo: "github.com/acme/repo-01",
          createdAt: "2026-09-21T10:00:00.000Z",
        }),
      ],
    });
    const repos = Array.from(
      { length: 12 },
      (_, i) => `acme/repo-${String(i).padStart(2, "0")}`,
    );

    const summary = await specUpkeepTick(
      {},
      {
        floor: recorded.floor,
        repos: () => Promise.resolve(repos),
        openPrBranches: () => Promise.resolve([]),
        now: () => MONDAY,
      },
    );

    const startedRepos = recorded.requests
      .filter(({ path }) => path.endsWith("/start"))
      .map(({ body }) => (body as { repo: string }).repo);

    expect(startedRepos).toEqual([
      "github.com/acme/repo-02",
      "github.com/acme/repo-03",
      "github.com/acme/repo-04",
      "github.com/acme/repo-05",
      "github.com/acme/repo-06",
      "github.com/acme/repo-07",
      "github.com/acme/repo-08",
      "github.com/acme/repo-09",
      "github.com/acme/repo-10",
      "github.com/acme/repo-11",
    ]);
    expect(summary).toBe("spec upkeep: started 10, skipped 0, failed 0");
  });
});
