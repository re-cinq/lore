import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(() => "re-cinq/checkout"),
  detectCurrentBranch: vi.fn(() => "topic"),
}));

import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { repoParam, resolveBranch, resolveRepo } from "./repo-scope.js";

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
