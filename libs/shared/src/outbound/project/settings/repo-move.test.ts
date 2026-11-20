import { describe, expect, it } from "vitest";
import { InMemoryKnowledge } from "./repo-move-memory.js";
import { settingsAfterMirrorMerge } from "./repo-move-row.js";
import { InMemorySettings } from "./settings-memory.js";

describe("InMemoryKnowledge", () => {
  it("moves 2 changelog weeks and keeps the week both repos hold, like the SQL", () => {
    const knowledge = new InMemoryKnowledge();

    knowledge.seed("lore.changelog_weeks", "acme/public", "W1");
    knowledge.seed("lore.changelog_weeks", "acme/public", "W2");
    knowledge.seed("lore.changelog_weeks", "acme/public", "W3");
    knowledge.seed("lore.changelog_weeks", "acme/private", "W3");

    const counts = knowledge.move("acme/public", "acme/private", {
      dryRun: false,
    });

    expect({
      changelog: counts.find((count) => count.table === "lore.changelog_weeks"),
      underPrivate: knowledge.rowsOf("lore.changelog_weeks", "acme/private"),
      underPublic: knowledge.rowsOf("lore.changelog_weeks", "acme/public"),
    }).toEqual({
      changelog: { table: "lore.changelog_weeks", moved: 2, kept_conflict: 1 },
      underPrivate: ["W1", "W2", "W3"],
      underPublic: ["W3"],
    });
  });

  it("reports 1 moved memory in a dry run and leaves it under acme/public", () => {
    const knowledge = new InMemoryKnowledge();

    knowledge.seed("memory.memories", "acme/public", "k");

    const counts = knowledge.move("acme/public", "acme/private", {
      dryRun: true,
    });

    expect({
      memories: counts.find((count) => count.table === "memory.memories"),
      underPublic: knowledge.rowsOf("memory.memories", "acme/public"),
    }).toEqual({
      memories: { table: "memory.memories", moved: 1, kept_conflict: 0 },
      underPublic: ["k"],
    });
  });
});

describe("settingsAfterMirrorMerge", () => {
  it("keeps the private release block, adds slack_channel_id and drops the mirror's public_mirror and auto_review", () => {
    expect(
      settingsAfterMirrorMerge(
        {
          public_mirror: "acme/x",
          release: { schedule: "daily" },
          slack_channel_id: "C99",
          auto_review: true,
        },
        { public_mirror: "acme/public", release: { schedule: "weekly" } },
      ),
    ).toEqual({
      public_mirror: "acme/public",
      release: { schedule: "weekly" },
      slack_channel_id: "C99",
    });
  });
});

describe("InMemorySettings.absorbMirrorRow cross-repo links", () => {
  it("points the links of third at the private repo once, and drops the private repo's own link to the mirror", async () => {
    const settings = new InMemorySettings([
      { full_name: "acme/public", settings: {} },
      {
        full_name: "acme/private",
        settings: {
          public_mirror: "acme/public",
          cross_repo_repos: ["acme/kept", "acme/public"],
        },
      },
      {
        full_name: "acme/third",
        settings: { cross_repo_repos: ["acme/other", "acme/public"] },
      },
      {
        full_name: "acme/both",
        settings: { cross_repo_repos: ["acme/public", "acme/private"] },
      },
    ]);

    await settings.absorbMirrorRow("acme/public", "acme/private");

    expect({
      third: (await settings.rawSettings("acme/third"))?.cross_repo_repos,
      both: (await settings.rawSettings("acme/both"))?.cross_repo_repos,
      private: (await settings.rawSettings("acme/private"))?.cross_repo_repos,
    }).toEqual({
      third: ["acme/other", "acme/private"],
      both: ["acme/private"],
      private: ["acme/kept"],
    });
  });

  it("carries the mirror's links onto a private repo with none, minus the private repo's own name", async () => {
    const settings = new InMemorySettings([
      {
        full_name: "acme/public",
        settings: { cross_repo_repos: ["acme/linked", "acme/private"] },
      },
      { full_name: "acme/private", settings: { public_mirror: "acme/public" } },
    ]);

    await settings.absorbMirrorRow("acme/public", "acme/private");

    expect(
      (await settings.rawSettings("acme/private"))?.cross_repo_repos,
    ).toEqual(["acme/linked"]);
  });
});
