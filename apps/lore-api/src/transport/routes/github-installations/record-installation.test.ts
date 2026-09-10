import { describe, it, expect } from "vitest";
import { InMemoryGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-memory.js";
import { InMemoryGithubApp } from "@re-cinq/lore-shared/project/github-installations/github-app-memory.js";
import { handleRecordInstallation } from "./record-installation.js";

const INSTALLED_AT = new Date("2026-09-10T20:00:00.000Z");

describe("handleRecordInstallation", () => {
  it("records installation 81234567 of re-cinq once GitHub confirms it belongs to this App", async () => {
    const installations = new InMemoryGithubInstallations(() => INSTALLED_AT);
    const app = new InMemoryGithubApp([
      {
        id: 81234567,
        account: { login: "re-cinq", type: "Organization" },
        repository_selection: "selected",
        suspended_at: null,
      },
    ]);

    expect(
      await handleRecordInstallation(
        { app, installations },
        { installation_id: 81234567 },
      ),
    ).toEqual({
      code: 200,
      body: {
        installation_id: "81234567",
        account_login: "re-cinq",
        account_type: "Organization",
        repository_selection: "selected",
        suspended_at: null,
        installed_at: INSTALLED_AT,
        updated_at: INSTALLED_AT,
      },
    });
    expect(await installations.findByAccount("re-cinq")).toMatchObject({
      installationId: "81234567",
    });
  });

  it("answers 404 for installation 99999999 that GitHub does not know as this App's, recording nothing", async () => {
    const installations = new InMemoryGithubInstallations(() => INSTALLED_AT);

    expect(
      await handleRecordInstallation(
        { app: new InMemoryGithubApp([]), installations },
        { installation_id: 99999999 },
      ),
    ).toEqual({
      code: 404,
      body: { error: "not-an-installation-of-this-app" },
    });
    expect(await installations.list()).toEqual([]);
  });
});
