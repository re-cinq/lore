import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlatformGitHub } from "./platform-github.js";

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
const answers: { releaseExists: boolean } = { releaseExists: true };

const releasePayload = {
  id: 77,
  tag_name: "v1.3.0",
  name: "v1.3.0",
  body: "Notes",
  draft: false,
  html_url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
};

function record(method: string, answer: unknown) {
  return async (params: Record<string, unknown>) => {
    calls.push({ method, params });

    if (!answers.releaseExists) {
      throw Object.assign(new Error("Not Found"), { status: 404 });
    }

    return { data: answer };
  };
}

vi.mock("octokit", () => ({
  Octokit: class {
    hook = { before: () => {} };
    rest = {
      git: { createRef: record("git.createRef", {}) },
      repos: {
        createRelease: record("repos.createRelease", releasePayload),
        getReleaseByTag: record("repos.getReleaseByTag", releasePayload),
        updateRelease: record("repos.updateRelease", releasePayload),
      },
      actions: {
        getRepoVariable: record("actions.getRepoVariable", {
          name: "LORE_MIRROR",
          value: "true",
        }),
      },
    };
  },
}));

describe("PlatformGitHub release surface", () => {
  const gh = () => new PlatformGitHub({ GITHUB_TOKEN: "gh-token" });

  beforeEach(() => {
    calls.length = 0;
    answers.releaseExists = true;
  });

  it("createTagRef posts refs/tags/v1.3.0 at the sha", async () => {
    await gh().createTagRef("re-cinq/lore", "v1.3.0", "a1b2c3");

    expect(calls).toEqual([
      {
        method: "git.createRef",
        params: {
          owner: "re-cinq",
          repo: "lore",
          ref: "refs/tags/v1.3.0",
          sha: "a1b2c3",
        },
      },
    ]);
  });

  it("createRelease sends the tag, name and notes as a published release and answers the record", async () => {
    const created = await gh().createRelease("re-cinq/lore", {
      tag: "v1.3.0",
      name: "v1.3.0",
      body: "Notes",
    });

    expect({ created, call: calls[0] }).toEqual({
      created: {
        id: 77,
        tag: "v1.3.0",
        name: "v1.3.0",
        body: "Notes",
        draft: false,
        url: "https://github.com/re-cinq/lore/releases/tag/v1.3.0",
      },
      call: {
        method: "repos.createRelease",
        params: {
          owner: "re-cinq",
          repo: "lore",
          tag_name: "v1.3.0",
          name: "v1.3.0",
          body: "Notes",
          draft: false,
        },
      },
    });
  });

  it("releaseByTag answers the record of v1.3.0", async () => {
    expect(await gh().releaseByTag("re-cinq/lore", "v1.3.0")).toMatchObject({
      id: 77,
      tag: "v1.3.0",
    });
  });

  it("releaseByTag answers null when GitHub has no release for the tag (404)", async () => {
    answers.releaseExists = false;

    expect(await gh().releaseByTag("re-cinq/lore", "v9.9.9")).toBe(null);
  });

  it("updateRelease sends release 77's new notes only", async () => {
    await gh().updateRelease("re-cinq/lore", 77, { body: "New notes" });

    expect(calls[0]).toEqual({
      method: "repos.updateRelease",
      params: {
        owner: "re-cinq",
        repo: "lore",
        release_id: 77,
        body: "New notes",
      },
    });
  });

  it("repoVariable answers true for LORE_MIRROR", async () => {
    expect(await gh().repoVariable("re-cinq/lore", "LORE_MIRROR")).toBe("true");
  });

  it("repoVariable answers null when the variable is not set (404)", async () => {
    answers.releaseExists = false;

    expect(await gh().repoVariable("re-cinq/lore", "LORE_MIRROR")).toBe(null);
  });

  it("createTagRef rethrows GitHub's error for a tag it cannot create", async () => {
    answers.releaseExists = false;

    await expect(
      gh().createTagRef("re-cinq/lore", "v1.3.0", "a1b2c3"),
    ).rejects.toThrow("Not Found");
  });
});
