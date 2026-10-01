import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(() => "re-cinq/checkout"),
  detectCurrentBranch: vi.fn(() => "topic"),
}));

import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  invalidRepoRefusal,
  repoParam,
  resolveBranch,
  resolveRepo,
  withRepo,
} from "./repo-scope.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveRepo / resolveBranch", () => {
  it("reads the checkout on a laptop when the call names nothing", () => {
    expect({
      repo: resolveRepo(undefined, "full"),
      branch: resolveBranch(undefined, "full"),
    }).toEqual({ repo: "re-cinq/checkout", branch: "topic" });
  });

  it("never shells out to git in the agent gateway, which has no checkout, and leaves an omitted repo to the caller", () => {
    expect({
      repo: resolveRepo(undefined, "agent"),
      branch: resolveBranch(undefined, "agent"),
      gitAsked:
        vi.mocked(detectCurrentRepo).mock.calls.length +
        vi.mocked(detectCurrentBranch).mock.calls.length,
    }).toEqual({ repo: null, branch: null, gitAsked: 0 });
  });

  it("takes the repo and branch the call names in either mode", () => {
    expect({
      repo: resolveRepo("re-cinq/lore", "agent"),
      branch: resolveBranch("main", "full"),
    }).toEqual({ repo: "re-cinq/lore", branch: "main" });
  });
});

describe("repoParam", () => {
  it("tells the gateway's caller the repo is required, and a laptop's that it is auto-detected", () => {
    expect({
      agent: repoParam("agent").description,
      full: repoParam("full").description,
    }).toEqual({
      agent:
        "'owner/repo'. Required: this server has no checkout to detect it from.",
      full: "'owner/repo'. Auto-detected from the git remote when omitted.",
    });
  });
});

describe("an explicit repo is validated before any API path is built from it", () => {
  const hostile = [
    "re-cinq/lore/../../pr-status",
    "re-cinq/lore?x=1",
    "re-cinq/lore/extra",
    "re-cinq",
    "../lore",
    "re-cinq/.",
    "re-cinq/..",
  ];

  it("refuses a repo that is not owner/name, with `..`, `?` or extra slashes", () => {
    expect(
      hostile.map((repo) => ({
        refusal: invalidRepoRefusal(repo),
        resolved: resolveRepo(repo, "agent"),
      })),
    ).toEqual(
      hostile.map((repo) => ({
        refusal: `Invalid repo '${repo}'. Pass repo as owner/name (e.g. 're-cinq/lore').`,
        resolved: null,
      })),
    );
  });

  it("accepts owner/name with dots, dashes and underscores", () => {
    expect(
      ["re-cinq/lore", "owner/my.repo_name-2"].map((repo) =>
        invalidRepoRefusal(repo),
      ),
    ).toEqual([null, null]);
  });

  it("answers with the refusal and never calls the read for a hostile repo", async () => {
    const read = vi.fn();
    const result = await withRepo(
      { repo: "re-cinq/lore?x=1" },
      "full",
      async (a) => read(a),
    );

    expect({ result, called: read.mock.calls.length }).toEqual({
      result: {
        content: [
          {
            type: "text",
            text: "Invalid repo 're-cinq/lore?x=1'. Pass repo as owner/name (e.g. 're-cinq/lore').",
          },
        ],
      },
      called: 0,
    });
  });

  it("answers that no repo could be detected on a laptop outside a checkout, instead of sending an empty repo", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValueOnce(null);
    const read = vi.fn();
    const result = (await withRepo({}, "full", async (a) => read(a))) as {
      content: { text: string }[];
    };

    expect({
      text: result.content[0].text,
      called: read.mock.calls.length,
    }).toEqual({
      text: "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
      called: 0,
    });
  });
});
