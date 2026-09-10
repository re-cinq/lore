import { describe, it, expect } from "vitest";
import { InMemoryGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-memory.js";
import { handleListInstallations } from "./list-installations.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");

describe("handleListInstallations", () => {
  it("lists the acme-corp and re-cinq installations in their wire shape, ordered by account login", async () => {
    const installations = new InMemoryGithubInstallations(() => INSTALLED_AT);

    await installations.upsert({
      installationId: "81234567",
      accountLogin: "re-cinq",
      accountType: "Organization",
      repositorySelection: "selected",
      suspendedAt: null,
    });
    await installations.upsert({
      installationId: "89990001",
      accountLogin: "acme-corp",
      accountType: "User",
      repositorySelection: "all",
      suspendedAt: null,
    });

    expect(await handleListInstallations({ installations })).toEqual({
      code: 200,
      body: [
        {
          installation_id: "89990001",
          account_login: "acme-corp",
          account_type: "User",
          repository_selection: "all",
          suspended_at: null,
          installed_at: INSTALLED_AT,
          updated_at: INSTALLED_AT,
        },
        {
          installation_id: "81234567",
          account_login: "re-cinq",
          account_type: "Organization",
          repository_selection: "selected",
          suspended_at: null,
          installed_at: INSTALLED_AT,
          updated_at: INSTALLED_AT,
        },
      ],
    });
  });
});
