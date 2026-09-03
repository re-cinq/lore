import { describe, it, expect, afterEach, vi } from "vitest";
import type { Request } from "@hapi/hapi";
import { makeOctokit } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../features/dark-factory/dark-factory-authz.js", () => {
  class TwoKeyError extends Error {
    constructor(
      message: string,
      public readonly code: string,
    ) {
      super(message);
    }
  }

  return { verifyApproval: vi.fn(), TwoKeyError };
});
vi.mock("../../platform/github-client.js", () => ({ getOctokit: vi.fn() }));

import { checkApproval } from "./two-key.js";
import {
  verifyApproval,
  TwoKeyError,
} from "../../features/dark-factory/dark-factory-authz.js";
import { getOctokit } from "../../platform/github-client.js";

const req = (approvalPr?: string) =>
  ({
    headers:
      approvalPr === undefined ? {} : { "x-lore-approval-pr": approvalPr },
  }) as unknown as Request;

describe("checkApproval", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 403 two_key_required when the approval header is absent", async () => {
    const outcome = await checkApproval(
      req(),
      "o/r",
      ["dark_factory.enabled"],
      "toggling dark mode",
    );

    expect(outcome).toEqual({
      ok: false,
      code: 403,
      body: {
        error: "two_key_required",
        field_paths: ["dark_factory.enabled"],
        detail: "toggling dark mode",
      },
    });
    expect(verifyApproval).not.toHaveBeenCalled();
  });

  it("returns 403 two_key_required when the approval header is an empty string", async () => {
    const outcome = await checkApproval(
      req(""),
      "o/r",
      ["image"],
      "setting image",
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: 403,
      body: { error: "two_key_required" },
    });
  });

  it("returns ok with the approval evidence after a CODEOWNERS approval", async () => {
    const octokit = makeOctokit();
    const evidence = { prRef: "#5", approver: "alice", prUrl: "https://gh/5" };

    vi.mocked(getOctokit).mockResolvedValue(octokit as never);
    vi.mocked(verifyApproval).mockResolvedValue(evidence);
    const outcome = await checkApproval(
      req("#5"),
      "o/r",
      ["image"],
      "setting image",
    );

    expect(outcome).toEqual({ ok: true, evidence });
    expect(verifyApproval).toHaveBeenCalledWith({
      octokit,
      prRef: "#5",
      targetRepo: "o/r",
    });
  });

  it("returns 403 codeowners_check_failed on a TwoKeyError", async () => {
    vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as never);
    vi.mocked(verifyApproval).mockRejectedValue(
      new TwoKeyError("approver is not a CODEOWNER", "approver_not_codeowner"),
    );
    const outcome = await checkApproval(
      req("#5"),
      "o/r",
      ["image"],
      "setting image",
    );

    expect(outcome).toEqual({
      ok: false,
      code: 403,
      body: {
        error: "codeowners_check_failed",
        code: "approver_not_codeowner",
        detail: "approver is not a CODEOWNER",
      },
    });
  });

  it("returns 503 github_api_unavailable on a non-TwoKey error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getOctokit).mockResolvedValue(makeOctokit() as never);
    vi.mocked(verifyApproval).mockRejectedValue(new Error("network down"));
    const outcome = await checkApproval(
      req("#5"),
      "o/r",
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
