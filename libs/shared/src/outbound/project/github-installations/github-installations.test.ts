import { describe, it, expect } from "vitest";
import { InMemoryGithubInstallations } from "./github-installations-memory.js";
import type { UpsertGithubInstallationInput } from "./github-installations-port.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");
const WIDENED_AT = new Date("2026-09-11T09:30:00.000Z");

const RE_CINQ: UpsertGithubInstallationInput = {
  installationId: "81234567",
  accountLogin: "re-cinq",
  accountType: "Organization",
  repositorySelection: "selected",
  suspendedAt: null,
};

describe("InMemoryGithubInstallations", () => {
  it("finds the re-cinq installation by its account login in any case", async () => {
    const installations = new InMemoryGithubInstallations(() => INSTALLED_AT);

    await installations.upsert(RE_CINQ);

    expect(await installations.findByAccount("RE-CINQ")).toEqual({
      ...RE_CINQ,
      installedAt: INSTALLED_AT,
      updatedAt: INSTALLED_AT,
    });
  });

  it("keeps when re-cinq was installed when the installation widens to all repos", async () => {
    let now = INSTALLED_AT;
    const installations = new InMemoryGithubInstallations(() => now);

    await installations.upsert(RE_CINQ);
    now = WIDENED_AT;
    await installations.upsert({ ...RE_CINQ, repositorySelection: "all" });

    expect(await installations.findByAccount("re-cinq")).toEqual({
      ...RE_CINQ,
      repositorySelection: "all",
      installedAt: INSTALLED_AT,
      updatedAt: WIDENED_AT,
    });
  });
});
