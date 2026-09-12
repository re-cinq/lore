import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
  detectCurrentBranch: vi.fn(),
}));

vi.mock("./deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi } from "./deps.js";
import { registerCiTools } from "./ci-tools.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

function handlerFor(name: string): ToolHandler {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(
      toolName: string,
      _desc: string,
      _schema: unknown,
      handler: ToolHandler,
    ) {
      handlers[toolName] = handler;
    },
  };

  registerCiTools(fakeServer as never);

  return handlers[name];
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
  it("asks for the checked-out branch of the detected repo when called with no arguments, which is all a pod knows", async () => {
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

describe("lore_get_ci_job_log", () => {
  it("asks for the job's tail with the grep and tail given, encoded", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    proxy.mockResolvedValue({
      ok: true,
      body: JSON.stringify({
        job_id: 7,
        lines: ["a b"],
        total: 1,
        truncated: false,
      }),
    });

    const result = await handlerFor("lore_get_ci_job_log")({
      job_id: 7,
      tail: 50,
      grep: "error TS",
    });

    expect({
      path: proxy.mock.calls[0][0],
      text: result.content[0].text,
    }).toEqual({
      path: "/api/repos/re-cinq/lore/ci-jobs/7/log?tail=50&grep=error+TS",
      text: JSON.stringify(
        { job_id: 7, lines: ["a b"], total: 1, truncated: false },
        null,
        2,
      ),
    });
  });

  it("asks for 200 lines when no tail is given", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    proxy.mockResolvedValue({ ok: true, body: "{}" });

    await handlerFor("lore_get_ci_job_log")({ job_id: 7 });

    expect(proxy.mock.calls[0][0]).toBe(
      "/api/repos/re-cinq/lore/ci-jobs/7/log?tail=200",
    );
  });
});

describe("lore_get_pr_status", () => {
  it("is served beside the CI reads, so an agent pod can ask whether its pull request is green", async () => {
    proxy.mockResolvedValue({
      ok: true,
      body: JSON.stringify({ state: "open" }),
    });

    const result = await handlerFor("lore_get_pr_status")({
      repo: "re-cinq/lore",
      pr_number: 5,
    });

    expect({
      path: proxy.mock.calls[0][0],
      text: result.content[0].text,
    }).toEqual({
      path: "/api/pr-status?repo=re-cinq%2Flore&pr_number=5",
      text: JSON.stringify({ state: "open" }, null, 2),
    });
  });
});
