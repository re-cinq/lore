import { describe, it, expect } from "vitest";
import { PgSettings, type RepoConfigWriter } from "./settings-pg.js";
import { resolveDarkFactorySettings } from "../../dark-factory-settings.js";
import type { PgPool } from "../../memory-store.js";

/**
 * PgSettings.resolve reads the JSONB row via a fake PgPool and resolves through
 * the real resolveDarkFactorySettings; var/secret delegate to the injected
 * writer. Proves SQL/binding and delegation without a live database or GitHub.
 */

function fakePool(
  capture: Array<{ text: string; params?: unknown[] }>,
  rows: unknown[],
): PgPool {
  return {
    query: async <T>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }> => {
      capture.push({ text, params });

      return { rows: rows as T[] as T[] };
    },
  };
}

function fakeWriter(
  calls: Array<{ kind: string; args: string[] }>,
): RepoConfigWriter {
  return {
    setRepoVariable: async (repo, name, value) => {
      calls.push({ kind: "var", args: [repo, name, value] });
    },
    setRepoSecret: async (repo, name, value) => {
      calls.push({ kind: "secret", args: [repo, name, value] });
    },
  };
}

describe("PgSettings", () => {
  it("resolves the repo's dark_factory settings from the JSONB row", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(
      fakePool(capture, [{ settings: { dark_factory: { enabled: true } } }]),
      fakeWriter([]),
    );

    const resolved = await store.resolve("re-cinq/lore");

    expect(capture[0].params).toEqual(["re-cinq/lore"]);
    expect(resolved).toEqual(resolveDarkFactorySettings({ enabled: true }));
  });

  it("falls back to defaults when the repo has no settings row", async () => {
    const store = new PgSettings(fakePool([], []), fakeWriter([]));

    expect(await store.resolve("missing/repo")).toEqual(
      resolveDarkFactorySettings(undefined),
    );
  });

  it("resolveOrNull returns null when the repo is not onboarded", async () => {
    const store = new PgSettings(fakePool([], []), fakeWriter([]));

    expect(await store.resolveOrNull("missing/repo")).toBeNull();
  });

  it("resolveOrNull resolves the settings when the repo row exists", async () => {
    const store = new PgSettings(
      fakePool([], [{ settings: { dark_factory: { enabled: true } } }]),
      fakeWriter([]),
    );

    expect(await store.resolveOrNull("re-cinq/lore")).toEqual(
      resolveDarkFactorySettings({ enabled: true }),
    );
  });

  it("delegates a variable write to the repo-config writer", async () => {
    const calls: Array<{ kind: string; args: string[] }> = [];
    const store = new PgSettings(fakePool([], []), fakeWriter(calls));

    await store.setRepoVariable(
      "re-cinq/lore",
      "LORE_INGEST_URL",
      "https://api",
    );

    expect(calls).toEqual([
      { kind: "var", args: ["re-cinq/lore", "LORE_INGEST_URL", "https://api"] },
    ]);
  });

  it("marks onboarding merged by full name for the onboard-task backstop", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, []), fakeWriter([]));

    await store.markOnboardingMergedByRepo("o/r");

    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("SET onboarding_pr_merged = true"),
      params: ["o/r"],
    });
  });

  it("nulls the onboarding PR url by row id when that PR closed unmerged", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, []), fakeWriter([]));

    await store.clearOnboardingPrUrl("repo-7");

    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("SET onboarding_pr_url = NULL"),
      params: ["repo-7"],
    });
  });
});
