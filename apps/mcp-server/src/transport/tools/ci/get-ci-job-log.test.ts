import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@re-cinq/lore-server-core/features/repo/repo-detect.js", () => ({
  detectCurrentRepo: vi.fn(),
}));

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { proxyGetApi } from "../shared/deps.js";
import { registerGetCiJobLogTool } from "./get-ci-job-log.js";
import type { ServerMode } from "../shared/repo-scope.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

function handlerFor(name: string, mode: ServerMode = "full") {
  return toolHandlers(registerGetCiJobLogTool, mode)[name];
}

const proxy = vi.mocked(proxyGetApi);

afterEach(() => {
  vi.clearAllMocks();
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

  it("answers with GitHub's own 403 refusal when the API relays it as a 424, never as a missing job", async () => {
    vi.mocked(detectCurrentRepo).mockReturnValue("re-cinq/lore");
    proxy.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail:
        "HTTP 424 Failed Dependency: GitHub would not serve the job log (403): Resource not accessible by integration",
    });

    const result = await handlerFor("lore_get_ci_job_log")({ job_id: 9 });

    expect(result.content[0].text).toBe(
      "Could not read the CI job log from the Lore API: HTTP 424 Failed Dependency: GitHub would not serve the job log (403): Resource not accessible by integration",
    );
  });
});
