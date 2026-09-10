import { describe, it, expect } from "vitest";
import { installationFromGithub } from "./installation-from-github.js";

describe("installationFromGithub", () => {
  it("reads GitHub's re-cinq installation as the organization installation 81234567 on selected repos", () => {
    expect(
      installationFromGithub({
        id: 81234567,
        account: { login: "re-cinq", type: "Organization" },
        repository_selection: "selected",
        suspended_at: null,
      }),
    ).toEqual({
      installationId: "81234567",
      accountLogin: "re-cinq",
      accountType: "Organization",
      repositorySelection: "selected",
      suspendedAt: null,
    });
  });
});
