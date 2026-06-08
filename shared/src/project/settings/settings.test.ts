import { describe, it, expect } from "vitest";
import { Settings } from "./settings.js";
import { resolveDarkFactorySettings } from "../../dark-factory-settings.js";
import type { SettingsPort } from "./settings-port.js";

/**
 * project.settings.resolve() is repo-bound and returns the resolved settings
 * unchanged. The fake resolves through the REAL resolveDarkFactorySettings to
 * prove the facade does no resolution of its own (move/wrap, never rewrite).
 */

function fakeSettings(setVars: Array<{ repo: string; name: string; value: string }>): SettingsPort {
  return {
    resolve: async (repo) =>
      resolveDarkFactorySettings(repo === "re-cinq/lore" ? { enabled: true } : null),
    setRepoVariable: async (repo, name, value) => {
      setVars.push({ repo, name, value });
    },
    setRepoSecret: async () => {},
  };
}

describe("Settings", () => {
  it("resolves the repo's settings via the real resolver", async () => {
    const facade = new Settings("re-cinq/lore", fakeSettings([]));

    expect(await facade.resolve()).toEqual(resolveDarkFactorySettings({ enabled: true }));
  });

  it("binds the repo when setting a GitHub variable", async () => {
    const setVars: Array<{ repo: string; name: string; value: string }> = [];
    const facade = new Settings("re-cinq/lore", fakeSettings(setVars));

    await facade.setRepoVariable("LORE_INGEST_URL", "https://api");

    expect(setVars).toEqual([{ repo: "re-cinq/lore", name: "LORE_INGEST_URL", value: "https://api" }]);
  });
});
