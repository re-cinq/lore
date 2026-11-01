import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../shared/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/deps.js")>()),
  proxyGetApi: vi.fn(),
}));

import { proxyGetApi } from "../shared/deps.js";
import { registerNextReadyIssueTool } from "./next-ready-issue.js";
import { toolHandlers } from "../shared/tool-test-helpers.js";

const nextReadyIssue = toolHandlers(registerNextReadyIssueTool, "full")[
  "lore_next_ready_issue"
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("lore_next_ready_issue", () => {
  it("skips held issue #1 and names #2 because of the loop's first criterion and its 3 unblocked issues", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: true,
      body: JSON.stringify({
        next: [
          { number: 1, hold: "blocked by #9" },
          { number: 2, unblocks_count: 3 },
        ],
        criteria: ["oldest first", "priority"],
      }),
    });

    const result = await nextReadyIssue({ repo: "acme/widgets" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      issue: { number: 2, unblocks_count: 3 },
      because: "oldest first (unblocks: 3)",
    });
  });

  it("reports no issue when the loop state has no next list", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({ ok: true, body: "{}" });

    const result = await nextReadyIssue({ repo: "acme/widgets" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      issue: null,
      reason: "No issues ready in the backlog.",
    });
  });

  it("reports no issue and an unreachable API when the read fails", async () => {
    vi.mocked(proxyGetApi).mockResolvedValueOnce({
      ok: false,
      reason: "unreachable",
      detail: "request timed out (15s)",
    });

    const result = await nextReadyIssue({ repo: "acme/widgets" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      issue: null,
      reason: "Could not reach Lore API.",
    });
  });
});
