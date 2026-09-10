import { describe, it, expect } from "vitest";
import { InMemoryGithubInstallations } from "./github-installations-memory.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");

describe("InMemoryGithubInstallations", () => {
  it("finds the re-cinq installation by its account login in any case", async () => {
    const installations = new InMemoryGithubInstallations(() => INSTALLED_AT);

    await installations.upsert({
      installationId: "81234567",
      accountLogin: "re-cinq",
      accountType: "Organization",
      repositorySelection: "selected",
      suspendedAt: null,
    });

    expect(await installations.findByAccount("RE-CINQ")).toEqual({
      installationId: "81234567",
      accountLogin: "re-cinq",
      accountType: "Organization",
      repositorySelection: "selected",
      suspendedAt: null,
      installedAt: INSTALLED_AT,
      updatedAt: INSTALLED_AT,
    });
  });
});
