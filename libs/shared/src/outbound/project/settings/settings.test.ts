import { describe, it, expect } from "vitest";
import { Settings } from "./settings.js";
import { InMemorySettings } from "./settings-memory.js";

describe("Settings", () => {
  it("binds the repo when setting a GitHub variable", async () => {
    const port = new InMemorySettings();
    const facade = new Settings("re-cinq/lore", port);

    await facade.setRepoVariable("LORE_INGEST_URL", "https://api");

    expect(port.vars).toEqual([
      { repo: "re-cinq/lore", name: "LORE_INGEST_URL", value: "https://api" },
    ]);
  });

  it("reads and overwrites the raw settings JSONB, repo bound", async () => {
    const port = new InMemorySettings([
      { full_name: "re-cinq/lore", settings: { trust: { level: "tests" } } },
    ]);
    const facade = new Settings("re-cinq/lore", port);

    expect(await facade.rawSettings()).toEqual({ trust: { level: "tests" } });

    await facade.updateSettings({ trust: { level: "implementation" } });

    expect(await facade.rawSettings()).toEqual({
      trust: { level: "implementation" },
    });
  });
});

describe("InMemorySettings.onboardedRepos", () => {
  it("returns only onboarded repos with their ingest stamp", async () => {
    const stamp = new Date("2026-06-01T00:00:00Z");
    const port = new InMemorySettings([
      { full_name: "a/b", onboarding_pr_merged: true, last_ingested_at: stamp },
      { full_name: "c/d", onboarding_pr_merged: false },
    ]);

    expect(await port.onboardedRepos()).toEqual([
      { full_name: "a/b", last_ingested_at: stamp },
    ]);
  });
});

describe("InMemorySettings.onboardedRepoSettings", () => {
  it("returns every onboarded repo with its raw settings", async () => {
    const port = new InMemorySettings([
      {
        full_name: "a/b",
        onboarding_pr_merged: true,
        settings: { slack_channel_id: "C1", digest: { enabled: true } },
      },
      { full_name: "c/d", onboarding_pr_merged: true },
      { full_name: "e/f", onboarding_pr_merged: false },
    ]);

    expect(await port.onboardedRepoSettings()).toEqual([
      {
        full_name: "a/b",
        settings: { slack_channel_id: "C1", digest: { enabled: true } },
      },
      { full_name: "c/d", settings: null },
    ]);
  });
});

describe("InMemorySettings.markOnboardingMergedById", () => {
  it("marks the onboarding merged and leaves a never-ingested repo's last_ingested_at unset", async () => {
    const port = new InMemorySettings([
      { id: "repo-42", full_name: "re-cinq/Otto", onboarding_pr_merged: false },
    ]);

    await port.markOnboardingMergedById("repo-42");

    expect(port.repos).toEqual([
      { id: "repo-42", full_name: "re-cinq/Otto", onboarding_pr_merged: true },
    ]);
  });
});

describe("InMemorySettings.allRepos", () => {
  it("lists every repo, onboarded or not", async () => {
    const port = new InMemorySettings([
      { full_name: "re-cinq/lore", onboarding_pr_merged: true },
      { full_name: "re-cinq/Otto", onboarding_pr_merged: false },
    ]);

    expect(await port.allRepos()).toEqual(["re-cinq/lore", "re-cinq/Otto"]);
  });
});

describe("InMemorySettings org settings", () => {
  it("answers the seeded slack_users value and null for a key that is not set", async () => {
    const port = new InMemorySettings();

    port.org.slack_users = '{"a":"U1"}';

    expect([
      await port.orgSetting("slack_users"),
      await port.orgSetting("other"),
    ]).toEqual(['{"a":"U1"}', null]);
  });
});
