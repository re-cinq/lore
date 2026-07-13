import { describe, it, expect } from "vitest";
import { Settings } from "./settings.js";
import { InMemorySettings } from "./settings-memory.js";
import { resolveDarkFactorySettings } from "../../dark-factory-settings.js";

/**
 * project.settings is repo-bound and delegates to the port. The InMemorySettings
 * double resolves through the REAL resolveDarkFactorySettings, proving the facade
 * does no resolution of its own (move/wrap, never rewrite).
 */

describe("Settings", () => {
  it("resolves the repo's settings via the real resolver", async () => {
    const port = new InMemorySettings([
      {
        full_name: "re-cinq/lore",
        settings: { dark_factory: { enabled: true } },
      },
    ]);
    const facade = new Settings("re-cinq/lore", port);

    expect(await facade.resolve()).toEqual(
      resolveDarkFactorySettings({ enabled: true }),
    );
  });

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
