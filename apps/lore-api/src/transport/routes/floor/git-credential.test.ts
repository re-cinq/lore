import { describe, it, expect } from "vitest";
import {
  configuredToken,
  handleFloorGitCredential,
  repoOfUrl,
} from "./git-credential.js";

const TOKEN = "floor-shared-token";

async function ask(
  bearer: string,
  repoUrl: string,
  token: string | null = TOKEN,
) {
  const minted: string[] = [];
  const result = await handleFloorGitCredential(
    {
      token: token ?? undefined,
      mint: async (repo) => {
        minted.push(repo);

        return "ghs_fresh";
      },
    },
    bearer,
    { repoUrl, access: "write" },
  );

  return { result, minted };
}

describe("handleFloorGitCredential", () => {
  it("answers 200 with the x-access-token pair minted for re-cinq/lore on a write request", async () => {
    expect(await ask(TOKEN, "https://github.com/re-cinq/lore")).toEqual({
      result: {
        code: 200,
        body: { username: "x-access-token", password: "ghs_fresh" },
      },
      minted: ["re-cinq/lore"],
    });
  });

  it("answers 401 and mints nothing for the wrong bearer", async () => {
    expect(await ask("wrong", "https://github.com/re-cinq/lore")).toEqual({
      result: { code: 401, body: { error: "bad-token" } },
      minted: [],
    });
  });

  it("answers 401 and mints nothing for an empty bearer", async () => {
    expect(await ask("", "https://github.com/re-cinq/lore")).toEqual({
      result: { code: 401, body: { error: "bad-token" } },
      minted: [],
    });
  });

  it("answers 503 and mints nothing when no token is configured", async () => {
    expect(await ask(TOKEN, "https://github.com/re-cinq/lore", null)).toEqual({
      result: { code: 503, body: { error: "not-configured" } },
      minted: [],
    });
  });

  it("answers 400 and mints nothing for https://gitlab.com/a/b", async () => {
    expect(await ask(TOKEN, "https://gitlab.com/a/b")).toEqual({
      result: { code: 400, body: { error: "not-a-github-repo-url" } },
      minted: [],
    });
  });

  it("passes the access level to mint as a second argument so the minter can narrow permissions for the pod", async () => {
    const mintCalls: Array<{ repo: string; access: string | undefined }> = [];
    const result = await handleFloorGitCredential(
      {
        token: TOKEN,
        mint: async (repo: string, access?: "read" | "write") => {
          mintCalls.push({ repo, access });

          return "ghs_fresh";
        },
      },
      TOKEN,
      { repoUrl: "https://github.com/re-cinq/lore", access: "read" },
    );

    expect(result.code).toBe(200);
    expect(mintCalls).toEqual([{ repo: "re-cinq/lore", access: "read" }]);
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

describe("configuredToken", () => {
  it("drops the newline a piped secret ends with", () => {
    expect(configuredToken("abc123\n")).toBe("abc123");
  });

  it("reads an empty secret as no token configured", () => {
    expect(configuredToken("\n")).toBeUndefined();
  });
});
