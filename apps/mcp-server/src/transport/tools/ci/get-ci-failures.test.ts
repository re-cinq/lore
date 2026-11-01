import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
  detectCurrentBranch: vi.fn(),
}));

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi } from "../shared/deps.js";
import { registerGetCiFailuresTool } from "./get-ci-failures.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerGetCiFailuresTool, mode)[name];
}

const proxy = vi.mocked(proxyGetApi);
const REPORT = {
  branch: "topic",
  judged_sha: "deadbeef",
  conclusion: "failure",
  failures: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_get_ci_failures", () => {
  it("asks for the checked-out branch of the detected repo when called with no arguments on a laptop", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    vi.mocked(detectCurrentBranch).mockReturnValue("lore/loop/issue-1510");
    proxy.mockResolvedValue({ ok: true, body: JSON.stringify(REPORT) });

    const result = await handlerFor("lore_get_ci_failures")({});

    expect({
      path: proxy.mock.calls[0][0],
      text: result.content[0].text,
    }).toEqual({
      path: "/api/repos/re-cinq/lore/ci-failures?branch=lore%2Floop%2Fissue-1510",
      text: JSON.stringify(REPORT, null, 2),
    });
  });

  it("asks by pull request number when given one, without touching git", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    proxy.mockResolvedValue({ ok: true, body: JSON.stringify(REPORT) });

    await handlerFor("lore_get_ci_failures")({ pr_number: 1684 });

    expect({
      path: proxy.mock.calls[0][0],
      gitAsked: vi.mocked(detectCurrentBranch).mock.calls.length,
    }).toEqual({
      path: "/api/repos/re-cinq/lore/ci-failures?pr_number=1684",
      gitAsked: 0,
    });
  });

  it("says what to pass when neither a branch nor a pull request can be found", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    vi.mocked(detectCurrentBranch).mockReturnValue(null);

    const result = await handlerFor("lore_get_ci_failures")({});

    expect({
      text: result.content[0].text,
      proxied: proxy.mock.calls.length,
    }).toEqual({
      text: "Could not detect the branch. Specify branch (e.g. 'feat/x') or pr_number.",
      proxied: 0,
    });
  });

  it("says what to pass when the repo cannot be detected", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue(null);

    const result = await handlerFor("lore_get_ci_failures")({
      branch: "topic",
    });

    expect(result.content[0].text).toBe(
      "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
    );
  });

  it("in the agent gateway asks for the repo and branch rather than running git, which it does not have", async () => {
    const noRepo = await handlerFor("lore_get_ci_failures", "agent")({});
    const noBranch = await handlerFor(
      "lore_get_ci_failures",
      "agent",
    )({ repo: "re-cinq/lore" });

    expect({
      noRepo: noRepo.content[0].text,
      noBranch: noBranch.content[0].text,
      gitAsked:
        vi.mocked(detectCurrentRepo).mock.calls.length +
        vi.mocked(detectCurrentBranch).mock.calls.length,
      proxied: proxy.mock.calls.length,
    }).toEqual({
      noRepo:
        "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.",
      noBranch:
        "Could not detect the branch. Specify branch (e.g. 'feat/x') or pr_number.",
      gitAsked: 0,
      proxied: 0,
    });
  });

  it("surfaces the server's own refusal rather than a generic unreachable line", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    proxy.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "pull request not found",
    });

    const result = await handlerFor("lore_get_ci_failures")({ pr_number: 9 });

    expect(result.content[0].text).toBe(
      "Could not read CI failures from the Lore API: pull request not found",
    );
  });
});
