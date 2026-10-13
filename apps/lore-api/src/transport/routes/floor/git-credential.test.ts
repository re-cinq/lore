import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import {
  configuredTokens,
  handleFloorGitCredential,
  isOnboarded,
  podPermissions,
  repoOfUrl,
  type GitCredentialMint,
} from "./git-credential.js";

const TOKEN = "floor-shared-token";

const ONBOARDED = ["re-cinq/lore"];

async function ask(
  bearer: string,
  repoUrl: string,
  tokens: string[] = [TOKEN],
  access: "read" | "write" = "write",
) {
  const minted: string[] = [];
  const audited: GitCredentialMint[] = [];
  const result = await handleFloorGitCredential(
    {
      tokens,
      mint: async (repo) => {
        minted.push(repo);

        return "ghs_fresh";
      },
      isOnboarded: async (repo) => ONBOARDED.includes(repo),
      audit: async (mint) => {
        audited.push(mint);
      },
    },
    bearer,
    { repoUrl, access },
  );

  return { result, minted, audited };
}

describe("handleFloorGitCredential", () => {
  it("answers 200 with the x-access-token pair minted for re-cinq/lore on a write request", async () => {
    expect(await ask(TOKEN, "https://github.com/re-cinq/lore")).toEqual({
      result: {
        code: 200,
        body: { username: "x-access-token", password: "ghs_fresh" },
      },
      minted: ["re-cinq/lore"],
      audited: [{ repo: "re-cinq/lore", access: "write", actor: "floor" }],
    });
  });

  it("answers 200 for the next token while the current one is still accepted during a rotation", async () => {
    expect(
      (
        await ask("next-token", "https://github.com/re-cinq/lore", [
          TOKEN,
          "next-token",
        ])
      ).result.code,
    ).toBe(200);
  });

  it("audits a read mint for re-cinq/lore as actor floor, never the shared bearer", async () => {
    const { audited } = await ask(
      TOKEN,
      "https://github.com/re-cinq/lore",
      [TOKEN],
      "read",
    );

    expect(audited).toEqual([
      { repo: "re-cinq/lore", access: "read", actor: "floor" },
    ]);
  });

  it("answers 403 and mints nothing for other/repo, which is not in lore.repos", async () => {
    expect(await ask(TOKEN, "https://github.com/other/repo")).toEqual({
      result: { code: 403, body: { error: "repo-not-onboarded" } },
      minted: [],
      audited: [],
    });
  });

  it("answers 401 and mints nothing for the wrong bearer", async () => {
    expect(await ask("wrong", "https://github.com/re-cinq/lore")).toEqual({
      result: { code: 401, body: { error: "bad-token" } },
      minted: [],
      audited: [],
    });
  });

  it("answers 401 and mints nothing for an empty bearer", async () => {
    expect(await ask("", "https://github.com/re-cinq/lore")).toEqual({
      result: { code: 401, body: { error: "bad-token" } },
      minted: [],
      audited: [],
    });
  });

  it("answers 503 and mints nothing when no token is configured", async () => {
    expect(await ask(TOKEN, "https://github.com/re-cinq/lore", [])).toEqual({
      result: { code: 503, body: { error: "not-configured" } },
      minted: [],
      audited: [],
    });
  });

  it("answers 400 and mints nothing for https://gitlab.com/a/b", async () => {
    expect(await ask(TOKEN, "https://gitlab.com/a/b")).toEqual({
      result: { code: 400, body: { error: "not-a-github-repo-url" } },
      minted: [],
      audited: [],
    });
  });
});

describe("isOnboarded", () => {
  it("asks lore.repos for re-cinq/otto regardless of letter case, since the pod names the repo in lowercase and the row keeps GitHub's spelling", async () => {
    const asked: { text: string; values: unknown[] }[] = [];
    const pool = {
      query: async (text: string, values: unknown[]) => {
        asked.push({ text, values });

        return { rowCount: 1 };
      },
    } as unknown as Pool;

    expect(await isOnboarded(pool, "re-cinq/otto")).toBe(true);
    expect(asked).toEqual([
      {
        text: "SELECT 1 FROM lore.repos WHERE LOWER(full_name) = LOWER($1)",
        values: ["re-cinq/otto"],
      },
    ]);
  });

  it("answers false for a repo no row matches", async () => {
    const pool = {
      query: async () => ({ rowCount: 0 }),
    } as unknown as Pool;

    expect(await isOnboarded(pool, "other/repo")).toBe(false);
  });
});

describe("repoOfUrl", () => {
  it("returns re-cinq/lore for https://github.com/re-cinq/lore.git", () => {
    expect(repoOfUrl("https://github.com/re-cinq/lore.git")).toBe(
      "re-cinq/lore",
    );
  });

  it("returns re-cinq/lore for https://github.com/re-cinq/lore/ with a trailing slash", () => {
    expect(repoOfUrl("https://github.com/re-cinq/lore/")).toBe("re-cinq/lore");
  });

  it("returns null for https://github.com.evil.io/a/b", () => {
    expect(repoOfUrl("https://github.com.evil.io/a/b")).toBeNull();
  });
});

describe("configuredTokens", () => {
  it("drops the newline a piped secret ends with", () => {
    expect(configuredTokens("abc123\n")).toEqual(["abc123"]);
  });

  it("reads an empty secret as no token configured", () => {
    expect(configuredTokens("\n")).toEqual([]);
  });

  it("reads 'current, next' as the two tokens a rotation accepts", () => {
    expect(configuredTokens("current, next")).toEqual(["current", "next"]);
  });
});

describe("podPermissions", () => {
  it("narrows a read token to contents:read and metadata:read", () => {
    expect(podPermissions("read")).toEqual({
      contents: "read",
      metadata: "read",
    });
  });

  it("gives a write token contents, pull requests, issues and workflows, and no secrets, hooks or checks", () => {
    expect(podPermissions("write")).toEqual({
      contents: "write",
      pull_requests: "write",
      issues: "write",
      workflows: "write",
      metadata: "read",
    });
  });
});
