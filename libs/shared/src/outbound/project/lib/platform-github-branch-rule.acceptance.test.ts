import { describe, it, expect, vi } from "vitest";
import { getBranchRule } from "./platform-github-branch-rule.js";
import { Octokit } from "octokit";

describe("Branch rule read", () => {
  it("marks classicProtectionReadable false when classic protection answers 403 so unreadable protection is not treated as no protection", async () => {
    const ok = new Octokit();

    vi.spyOn(ok as any, "request").mockImplementation(
      async (route: unknown) => {
        if (route === "GET /repos/{owner}/{repo}/rules/branches/{branch}") {
          return { data: [] };
        }

        if (
          route === "GET /repos/{owner}/{repo}/branches/{branch}/protection"
        ) {
          throw Object.assign(
            new Error("Resource not accessible by integration"),
            { status: 403 },
          );
        }

        return { data: {} };
      },
    );

    await expect(getBranchRule(ok, "re-cinq/lore", "main")).resolves.toEqual({
      requiredApprovals: 0,
      codeOwnersReview: false,
      requiredChecks: [],
      classicProtectionReadable: false,
    });
  });
});
