import { describe, it, expect, vi } from "vitest";
import type { Request } from "@hapi/hapi";
import { checkApproval } from "./two-key.js";
import { getOctokit } from "../../outbound/github-client.js";
import { makeOctokit } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../outbound/github-client.js", () => ({ getOctokit: vi.fn() }));

describe("checkApproval", () => {
  it("yields HTTP 503 github_api_unavailable on a GitHub API outage through verifyApproval", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const octokit = makeOctokit();

    octokit.rest.pulls.get = vi
      .fn()
      .mockRejectedValue(new Error("network down"));

    vi.mocked(getOctokit).mockResolvedValue(octokit as never);

    const req = {
      headers: { "x-lore-approval-pr": "owner/repo#42" },
    } as unknown as Request;

    const outcome = await checkApproval(
      req,
      "owner/repo",
      ["image"],
      "setting image",
    );

    expect(outcome).toEqual({
      ok: false,
      code: 503,
      body: { error: "github_api_unavailable" },
    });
  });
});
