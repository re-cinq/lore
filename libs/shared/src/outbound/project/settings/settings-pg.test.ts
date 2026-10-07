import { describe, it, expect } from "vitest";
import { PgSettings, type RepoConfigWriter } from "./settings-pg.js";
import type { PgPool } from "../../memory-store.js";

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
  it("reads the org setting slack_users from lore.settings by its key", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, [{ value: '{"a":"U1"}' }]));

    expect(await store.orgSetting("slack_users")).toBe('{"a":"U1"}');
    expect(capture[0]).toEqual({
      text: "SELECT value FROM lore.settings WHERE key = $1",
      params: ["slack_users"],
    });
  });

  it("answers null for an org setting that is not set", async () => {
    const store = new PgSettings(fakePool([], []));

    expect(await store.orgSetting("slack_users")).toBeNull();
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

  it("nulls the onboarding PR url by row id when that PR closed unmerged", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, []), fakeWriter([]));

    await store.clearOnboardingPrUrl("repo-7");

    expect(capture[0]).toMatchObject({
      text: expect.stringContaining("SET onboarding_pr_url = NULL"),
      params: ["repo-7"],
    });
  });

  it("marks repo-42's onboarding merged without stamping last_ingested_at", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(fakePool(capture, []), fakeWriter([]));

    await store.markOnboardingMergedById("repo-42");

    expect(capture).toEqual([
      {
        text: expect.not.stringContaining("last_ingested_at"),
        params: ["repo-42"],
      },
    ]);
  });
});

describe("PgSettings.allRepos", () => {
  it("reads every repo row with no onboarding filter", async () => {
    const capture: Array<{ text: string; params?: unknown[] }> = [];
    const store = new PgSettings(
      fakePool(capture, [
        { full_name: "re-cinq/Otto" },
        { full_name: "re-cinq/lore" },
      ]),
      fakeWriter([]),
    );

    expect(await store.allRepos()).toEqual(["re-cinq/Otto", "re-cinq/lore"]);
    expect(capture[0].text).not.toContain("onboarding_pr_merged");
  });
});
